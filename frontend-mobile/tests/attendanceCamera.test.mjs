import assert from 'node:assert/strict';
import test from 'node:test';
import { installMocks, render, allText, findPressable, press } from './support/nativeHarness.mjs';

const React = (await import('react')).default;
const { act } = await import('react-test-renderer');

// lucide and react-native-svg do not load under node: stand in plain elements.
let backHandler = null;
installMocks({
  '/ui/icon': { Icon: props => React.createElement('Icon', props) },
  'react-native-svg': { __esModule: true, default: 'Svg', Svg: 'Svg', Path: 'Path', Ellipse: 'Ellipse' },
  'react-native': {
    BackHandler: { addEventListener: (_name, handler) => { backHandler = handler; return { remove() {} }; } },
  },
});
const { AttendanceCamera } = await import('../src/components/AttendanceCamera.tsx');
const { NativeFontsReady } = await import('../src/fonts.ts');

test('attendance uses its front camera, guards duplicate captures and retries failed uploads', async () => {
  let renderer, pictures = 0, uploads = 0, cancels = 0, release;
  const camera = { takePictureAsync: async () => { pictures++; return { uri: 'selfie.jpg' }; } };
  renderer = await render(React.createElement(AttendanceCamera, {
    mode: 'check-in', onCancel() { cancels++; }, onCapture: async uri => {
      assert.equal(uri, 'selfie.jpg'); uploads++;
      if (uploads === 1) await new Promise((_resolve, reject) => { release = reject; });
    },
  }));
  try {
    const view = renderer.root.findByType('CameraView');
    assert.equal(view.props.facing, 'front');
    // react-test-renderer has no native camera: hand the component a fake ref target.
    const ref = view.props.ref ?? view.instance;
    if (typeof ref === 'function') ref(camera); else if (ref && 'current' in ref) ref.current = camera;
    const take = () => findPressable(renderer, 'Take selfie');
    assert.ok(allText(renderer).includes('Check-in selfie'));
    await press(take());
    assert.equal(pictures, 0, 'wait for camera readiness');
    assert.equal(take().props.accessibilityState.disabled, true);
    assert.ok(allText(renderer).includes('Opening camera…'));
    await act(async () => { view.props.onCameraReady(); take().props.onPress(); take().props.onPress(); });
    assert.equal(pictures, 1); assert.equal(uploads, 1);
    assert.equal(take().props.accessibilityState.busy, true);
    assert.ok(allText(renderer).includes('Saving your attendance…'));
    // Hardware back and the close button do nothing while the selfie is being saved.
    assert.equal(backHandler(), true);
    await press(findPressable(renderer, 'Cancel'));
    assert.equal(cancels, 0);
    await act(async () => { release(new Error('Upload failed. Retry your selfie.')); });
    assert.ok(allText(renderer).includes('Upload failed. Retry your selfie.'));
    assert.equal(take().props.accessibilityState.busy, false);
    assert.equal(allText(renderer).includes('Saving your attendance…'), false);
    await press(take());
    assert.equal(pictures, 2); assert.equal(uploads, 2);
    assert.equal(allText(renderer).includes('Upload failed.'), false);
    assert.equal(backHandler(), true);
    assert.equal(cancels, 1);
  } finally {
    await act(async () => renderer.update(React.createElement(NativeFontsReady.Provider, { value: true }, null)));
  }
});
