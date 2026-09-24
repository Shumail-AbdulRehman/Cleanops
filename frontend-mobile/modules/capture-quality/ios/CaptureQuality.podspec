Pod::Spec.new do |s|
  s.name = 'CaptureQuality'
  s.version = '1.0.0'
  s.summary = 'Local controlled still quality and boot clock'
  s.description = 'Privacy-preserving on-device still analysis for Hygene Ops'
  s.author = 'Hygene Ops'
  s.homepage = 'https://hygeneops.com'
  s.license = { :type => 'MIT' }
  s.platforms = { :ios => '15.1' }
  s.source = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.{h,m,mm,swift}'
end
