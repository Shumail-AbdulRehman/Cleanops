import ExpoModulesCore
import ARKit
import SceneKit
import CoreImage
import UIKit

private let engine = SpatialEngine()
private class SpatialEngine: NSObject, ARSessionDelegate {
  let session = ARSession()
  weak var preview: ARSCNView?
  var broken = false
  var hadGood = false
  var lostAt: TimeInterval?
  var running = false
  var startedAt = 0.0
  let images = CIContext()
  override init() { super.init(); session.delegate = self; session.delegateQueue = .main }
  func stop() { session.pause(); running = false; broken = true }
  func start() throws {
    guard ARWorldTrackingConfiguration.isSupported else { throw NSError(domain:"SpatialUnsupported",code:1) }
    if running { return }
    let config = ARWorldTrackingConfiguration()
    config.planeDetection = [.horizontal, .vertical]
    // No map persistence, cloud anchors, frame recording or scene reconstruction.
    broken = false; hadGood = false; lostAt = nil; startedAt = ProcessInfo.processInfo.systemUptime; running = true
    session.run(config, options: [.resetTracking, .removeExistingAnchors])
  }
  func sessionWasInterrupted(_ session: ARSession) { stop() }
  func session(_ session: ARSession, didFailWithError error: Error) { stop() }
  func session(_ session: ARSession, didUpdate frame: ARFrame) {
    switch frame.camera.trackingState {
    case .normal: hadGood = true; lostAt = nil
    default:
      if hadGood {
        if lostAt == nil { lostAt = frame.timestamp }
        if frame.timestamp - (lostAt ?? frame.timestamp) > 3 { broken = true }
      }
    }
  }
  func sample(_ frame: ARFrame?) -> [String:Any] {
    guard running, let frame = frame, frame.timestamp >= startedAt, ProcessInfo.processInfo.systemUptime - frame.timestamp < 0.5 else {
      return ["tracking":"UNAVAILABLE", "continuity":"BROKEN", "camera":NSNull(), "worldPoint":NSNull(), "nativeTimestampMs":NSNull()]
    }
    let quality: String
    switch frame.camera.trackingState { case .normal: quality = "GOOD"; case .notAvailable: quality = "LOST"; default: quality = "DEGRADED" }
    let t = frame.camera.transform; let q = simd_quatf(t).vector
    func position(_ v: SIMD4<Float>) -> [String:Double] { ["x":Double(v.x),"y":Double(v.y),"z":Double(v.z)] }
    var point: Any = NSNull()
    // Existing geometry is a geometric candidate, not semantic toilet detection.
    let origin = SIMD3<Float>(t.columns.3.x,t.columns.3.y,t.columns.3.z)
    let direction = -SIMD3<Float>(t.columns.2.x,t.columns.2.y,t.columns.2.z)
    let query = ARRaycastQuery(origin:origin,direction:direction,allowing:.existingPlaneGeometry,alignment:.any)
    if quality == "GOOD", let hit = session.raycast(query).first {
      point = ["position":position(hit.worldTransform.columns.3),"method":"CENTER_PLANE", "quality":"CANDIDATE", "uncertaintyMeters":NSNull()] as [String:Any]
    }
    return ["tracking":quality,"continuity":broken ? "BROKEN":"CONTINUOUS","nativeTimestampMs":frame.timestamp * 1000,
            "camera":["position":position(t.columns.3),"orientation":["x":Double(q.x),"y":Double(q.y),"z":Double(q.z),"w":Double(q.w)]],"worldPoint":point]
  }
  func capture() throws -> [String:Any] {
    guard running, let frame = session.currentFrame, frame.timestamp >= startedAt,
          ProcessInfo.processInfo.systemUptime - frame.timestamp < 0.5 else { throw NSError(domain:"SpatialCameraNotReady",code:1) }
    let sample = sample(frame)
    // The still and transform come from exactly the same ARFrame.
    let image = CIImage(cvPixelBuffer:frame.capturedImage).oriented(.right)
    guard let cg = images.createCGImage(image,from:image.extent), let data = UIImage(cgImage:cg).jpegData(compressionQuality:0.9) else { throw NSError(domain:"SpatialStill",code:2) }
    let directory = FileManager.default.urls(for:.cachesDirectory,in:.userDomainMask)[0].appendingPathComponent("Camera",isDirectory:true)
    try FileManager.default.createDirectory(at:directory,withIntermediateDirectories:true)
    let file = directory.appendingPathComponent("spatial-\(UUID().uuidString).jpg")
    try data.write(to:file,options:.atomic)
    return ["uri":file.absoluteString,"sample":sample]
  }
}
class SpatialCameraView: ExpoView {
  let camera = ARSCNView()
  private var attached = false
  required init(appContext:AppContext? = nil) {
    super.init(appContext:appContext)
    camera.session = engine.session; camera.automaticallyUpdatesLighting = false
    addSubview(camera); engine.preview = camera
  }
  override func layoutSubviews() { super.layoutSubviews(); camera.frame = bounds }
  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window != nil { attached = true; engine.preview = camera }
    else if attached { engine.stop(); attached = false }
  }
}
public class SpatialTrackingModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SpatialTracking")
    AsyncFunction("isSupported") { () -> String in ARWorldTrackingConfiguration.isSupported ? "LIMITED_SPATIAL":"NO_SPATIAL" }
    AsyncFunction("start") { try engine.start() }.runOnQueue(.main)
    AsyncFunction("stop") { engine.stop() }.runOnQueue(.main)
    AsyncFunction("interrupt") { engine.stop() }.runOnQueue(.main)
    AsyncFunction("getTrackingState") { engine.sample(engine.session.currentFrame) }.runOnQueue(.main)
    AsyncFunction("captureSpatialObservation") { try engine.capture() }.runOnQueue(.main)
    OnAppEntersBackground { engine.stop() }
    OnDestroy { engine.stop() }
    View(SpatialCameraView.self) {}
  }
}
