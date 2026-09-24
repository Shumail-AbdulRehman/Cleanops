Pod::Spec.new do |s|
  s.name = 'SpatialTracking'
  s.version = '1.0.0'
  s.summary = 'Local continuous spatial tracking and controlled stills'
  s.description = 'ARKit camera session; no video recording or cloud anchors'
  s.author = 'Hygene Ops'
  s.homepage = 'https://hygeneops.com'
  s.license = { :type => 'MIT' }
  s.platforms = { :ios => '15.1' }
  s.source = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'ARKit', 'SceneKit', 'CoreImage'
  s.source_files = '**/*.{h,m,mm,swift}'
end
