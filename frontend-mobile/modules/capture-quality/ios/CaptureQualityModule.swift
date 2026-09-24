import ExpoModulesCore
import UIKit
import Darwin
public class CaptureQualityModule: Module {
  public func definition() -> ModuleDefinition {
    Name("CaptureQuality")
    Function("clock") { () -> [String: Any] in
      var boot = timeval(); var size = MemoryLayout<timeval>.size
      guard sysctlbyname("kern.boottime", &boot, &size, nil, 0) == 0 else { throw NSError(domain: "CaptureClock", code: 1) }
      var info = mach_timebase_info_data_t(); mach_timebase_info(&info)
      let elapsed = Double(mach_continuous_time()) * Double(info.numer) / Double(info.denom) / 1_000_000
      return ["bootId": "ios-\(boot.tv_sec)-\(boot.tv_usec)", "elapsedMs": elapsed]
    }
    AsyncFunction("inspect") { (uri: String) -> [String: Any] in
      guard let url = URL(string: uri), url.isFileURL, let image = UIImage(contentsOfFile: url.path), let source = image.cgImage else {
        throw NSError(domain: "CaptureQuality", code: 1)
      }
      let width = 128, height = max(3, Int(Double(source.height) / Double(source.width) * 128))
      var pixels = [UInt8](repeating: 0, count: width * height * 4)
      let rendered = pixels.withUnsafeMutableBytes { bytes -> Bool in
        guard let context = CGContext(data: bytes.baseAddress, width: width, height: height, bitsPerComponent: 8,
          bytesPerRow: width * 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return false }
        context.draw(source, in: CGRect(x: 0, y: 0, width: width, height: height)); return true
      }
      guard rendered else { throw NSError(domain: "CaptureQuality", code: 2) }
      let luma = (0..<(width * height)).map { i in
        .2126 * Double(pixels[i * 4]) + .7152 * Double(pixels[i * 4 + 1]) + .0722 * Double(pixels[i * 4 + 2])
      }
      var sum = 0.0, sumSq = 0.0, n = 0.0
      for y in 1..<(height - 1) { for x in 1..<(width - 1) {
        let i = y * width + x
        let v = luma[i-1] + luma[i+1] + luma[i-width] + luma[i+width] - 4 * luma[i]
        sum += v; sumSq += v * v; n += 1
      }}
      return ["width": source.width, "height": source.height,
        "luminance": luma.reduce(0,+) / Double(luma.count),
        "laplacianVariance": max(0, sumSq / n - pow(sum / n, 2)),
        "clipping": Double(luma.filter { $0 < 5 || $0 > 250 }.count) / Double(luma.count)]
    }
  }
}
