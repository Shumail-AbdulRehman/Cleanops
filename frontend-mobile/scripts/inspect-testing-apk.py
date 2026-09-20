"""Inspect a real APK; this does not certify runtime or physical sensor accuracy."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import struct
import subprocess
import xml.etree.ElementTree as ET
import zipfile


def defined_dex_classes(data):
    if not data.startswith(b'dex\n'):
        raise ValueError('Expected standard Android DEX')
    string_count, strings_offset, type_count, types_offset = struct.unpack_from('<IIII', data, 56)
    class_count, classes_offset = struct.unpack_from('<II', data, 96)
    result = set()
    for index in range(class_count):
        type_index = struct.unpack_from('<I', data, classes_offset + index * 32)[0]
        if type_index >= type_count:
            raise ValueError('Invalid DEX type index')
        string_index = struct.unpack_from('<I', data, types_offset + type_index * 4)[0]
        if string_index >= string_count:
            raise ValueError('Invalid DEX string index')
        offset = struct.unpack_from('<I', data, strings_offset + string_index * 4)[0]
        while data[offset] & 0x80:
            offset += 1
        offset += 1  # Skip ULEB128 UTF-16 length; descriptors are ASCII.
        descriptor = data[offset:data.index(b'\0', offset)].decode('ascii')
        result.add(descriptor[1:-1].replace('/', '.'))
    return result


def inspect(apk, api_url, commit, require_notifications=False, require_heads_up=False, push_only=False):
    require_notifications = require_notifications or require_heads_up
    sdk = os.environ.get('ANDROID_HOME') or os.environ.get('ANDROID_SDK_ROOT')
    if not sdk:
        raise ValueError('Set ANDROID_HOME to inspect the compiled APK manifest')
    analyzer = Path(sdk) / 'cmdline-tools/latest/bin/apkanalyzer'
    manifest = subprocess.check_output([str(analyzer), 'manifest', 'print', str(apk)], text=True)
    root = ET.fromstring(manifest)
    android = '{http://schemas.android.com/apk/res/android}'
    package = root.get('package')
    if package != 'com.hygeneops.staff':
        raise ValueError(f'Unexpected application ID: {package}')
    permissions = {node.get(android + 'name') for node in root.findall('uses-permission')}
    required_permissions = {'android.permission.CAMERA', 'android.permission.ACCESS_COARSE_LOCATION',
                           'android.permission.ACCESS_FINE_LOCATION', 'android.permission.INTERNET'}
    if require_notifications:
        required_permissions.add('android.permission.POST_NOTIFICATIONS')
    if not required_permissions <= permissions or 'android.permission.RECORD_AUDIO' in permissions:
        raise ValueError('Required camera/location/network permissions or microphone removal failed')
    application = root.find('application')
    metadata = {node.get(android + 'name'): node.get(android + 'value') or node.get(android + 'resource')
                for node in application.findall('meta-data')}
    if metadata.get('com.google.ar.core') != 'optional':
        raise ValueError('ARCore must remain optional for unsupported-device fallback')
    if api_url.startswith('http:') and application.get(android + 'usesCleartextTraffic') != 'true':
        raise ValueError('Configured HTTP test API would be blocked by the manifest')
    required_modules = {
        'expo.modules.spatialtracking.SpatialTrackingModule',
        'expo.modules.capturequality.CaptureQualityModule', 'expo.modules.camera.CameraViewModule',
        'expo.modules.location.LocationModule',
        'expo.modules.securestore.SecureStoreModule', 'expo.modules.filesystem.FileSystemModule',
        'expo.modules.filesystem.legacy.FileSystemLegacyModule', 'expo.modules.crypto.CryptoModule',
        'com.reactnativecommunity.netinfo.NetInfoModule',
    }
    if not push_only:
        required_modules.add('expo.modules.speech.SpeechModule')
    if require_notifications:
        required_modules.update({
            'expo.modules.notifications.tokens.PushTokenModule',
            'expo.modules.notifications.permissions.NotificationPermissionsModule',
            'expo.modules.notifications.service.ExpoFirebaseMessagingService',
            'expo.modules.device.DeviceModule',
            'com.google.firebase.messaging.FirebaseMessaging',
        })
        expected_channel = 'staff-task-assigned-v3' if require_heads_up else 'tasks'
        if metadata.get('com.google.firebase.messaging.default_notification_channel_id') != expected_channel:
            raise ValueError('Default task notification channel is missing')
        services = {node.get(android + 'name') for node in application.findall('service')}
        if 'expo.modules.notifications.service.ExpoFirebaseMessagingService' not in services:
            raise ValueError('Expo Firebase messaging service is not registered')
    with zipfile.ZipFile(apk) as archive:
        names = archive.namelist()
        if require_heads_up:
            for key in ['expo.modules.notifications.default_notification_icon',
                        'com.google.firebase.messaging.default_notification_icon',
                        'expo.modules.notifications.large_notification_icon']:
                if not metadata.get(key):
                    raise ValueError(f'Branded notification icon metadata missing: {key}')
            # Release resource optimization renames files, so resolve their paths
            # through the resource table instead of guessing ZIP entry names.
            for resource in ['notification_icon', 'hygene_notification_brand']:
                icons = []
                for density in ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi']:
                    icon = subprocess.check_output([
                        str(analyzer), 'resources', 'value', '--config', density,
                        '--type', 'drawable', '--name', resource, str(apk)
                    ], text=True).strip()
                    if icon not in names or not archive.read(icon).startswith(b'\x89PNG\r\n\x1a\n'):
                        raise ValueError(f'Notification icon missing: {resource}/{density}')
                    icons.append(icon)
                if len(set(icons)) != 5:
                    raise ValueError(f'Expected five density variants for {resource}')
        classes = set()
        for name in names:
            if name.startswith('classes') and name.endswith('.dex'):
                classes.update(defined_dex_classes(archive.read(name)))
        if not required_modules <= classes:
            raise ValueError(f'Native module classes missing: {sorted(required_modules - classes)}')
        if push_only and 'expo.modules.speech.SpeechModule' in classes:
            raise ValueError('Removed speech module is still packaged')
        normalized_url = api_url.strip().rstrip('/')
        if not normalized_url.endswith('/api'):
            normalized_url += '/api'
        bundle = archive.read('assets/index.android.bundle')
        event_channels = [b'staff-task-assigned-v3', b'staff-task-changed-v3', b'staff-shift-approaching-v3', b'staff-missing-check-in-v3', b'staff-checkout-approaching-v3']
        if require_heads_up and not all(marker in bundle for marker in event_channels):
            raise ValueError('Heads-up channel migration missing from bundled JavaScript')
        if require_notifications and not all(marker in bundle for marker in [b'/staff/mobile/tasks', b'/staff-notifications/devices']):
            raise ValueError('Optimized mobile queries or push registration are missing from the bundle')
        # Retained translations do not establish that a retired UI is mounted.
        # Native speech is denied above; reject actual retired inbox API callers.
        if push_only and any(marker in bundle for marker in [b'/staff-notifications/unread-count', b'/staff-notifications/read-all']):
            raise ValueError('Removed inbox API is still bundled')
        for name in names:
            if name.endswith('.json'):
                try:
                    value = json.loads(archive.read(name))
                except (ValueError, UnicodeDecodeError):
                    continue
                if isinstance(value, dict) and value.get('type') == 'service_account' and value.get('private_key'):
                    raise ValueError('Private service-account credentials must never be packaged')
        if normalized_url.encode() not in bundle:
            raise ValueError('Expected phone-accessible API URL missing from bundled JavaScript')
        if not all(marker in bundle for marker in [b'Task completed', b'Photo received and being checked', b'Scan the room QR again', b'activate-photo']):
            raise ValueError('Sequential staff submission UX is missing from bundled JavaScript')
        direct_markers = [b'Upload again', b'Check result', b'This picture is temporary.']
        if not all(marker in bundle for marker in direct_markers):
            raise ValueError('Direct photo upload UX missing from bundled JavaScript')
        if 'expo.modules.sqlite.SQLiteModule' in classes:
            raise ValueError('Removed persistent photo storage is still packaged')
        if any(name.endswith('.onnx') or 'clip-text-vectors' in name or 'onnxruntime' in name.lower() for name in names):
            raise ValueError('Removed local AI model/runtime is still packaged')
        if any(name.startswith('ai.onnxruntime.') for name in classes):
            raise ValueError('Removed ONNX Java runtime is still packaged')
        abis = {name.split('/')[1] for name in names if name.startswith('lib/') and name.endswith('.so')}
        for abi in ('arm64-v8a', 'armeabi-v7a'):
            required_libraries = {f'lib/{abi}/libarcore_sdk_jni.so'}
            if not required_libraries <= set(names):
                raise ValueError(f'Missing ARCore native libraries for {abi}')
    size = apk.stat().st_size
    if not 10 * 1024 * 1024 < size < 500 * 1024 * 1024:
        raise ValueError(f'Unexpected APK size: {size} bytes')
    return {'applicationId': package, 'versionName': root.get(android + 'versionName'),
            'versionCode': int(root.get(android + 'versionCode')), 'directPhotoUploads': True, 'persistentPhotoStorage': False,
            'localCategoryModelBundled': False, 'onnxRuntimeBundled': False,
            'sizeBytes': size, 'sha256': hashlib.file_digest(apk.open('rb'), 'sha256').hexdigest(),
            'apiBaseUrl': normalized_url, 'commit': commit, 'abis': sorted(abis),
            'permissions': sorted(permissions), 'arCore': 'optional',
            'notificationsPackagingValidated': require_notifications,
            'headsUpChannelsConfigured': require_heads_up,
            'brandedNotificationIconsValidated': require_heads_up,
            'pushOnlyInterface': push_only, 'speechModuleRemoved': push_only,
            'nativeModules': sorted(required_modules), 'sqlCipherNativeProbePresent': False,
            'spatialAutomaticAcceptance': False, 'cleanlinessAutomaticPassing': 'server-controlled validated release',
            'staffSubmissionLabels': ['Task completed'], 'sequentialPhotoChecks': True, 'localCategoryGate': False,
            'physicalSensorAccuracyValidated': False, 'signingPurpose': 'testing/debug key'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('apk', type=Path)
    parser.add_argument('--api-url', required=True)
    parser.add_argument('--commit', default='unknown')
    parser.add_argument('--require-notifications', action='store_true')
    parser.add_argument('--require-heads-up', action='store_true')
    parser.add_argument('--push-only', action='store_true')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    result = inspect(args.apk.resolve(), args.api_url, args.commit, args.require_notifications, args.require_heads_up, args.push_only)
    args.output.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2))
