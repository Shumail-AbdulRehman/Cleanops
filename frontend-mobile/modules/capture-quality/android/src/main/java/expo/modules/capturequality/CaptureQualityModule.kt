package expo.modules.capturequality
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.SystemClock
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class CaptureQualityModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("CaptureQuality")
    Function("clock") {
      val context = appContext.reactContext ?: error("Application unavailable")
      val boot = Settings.Global.getInt(context.contentResolver, Settings.Global.BOOT_COUNT, -1)
      if (boot < 0) error("Boot clock unavailable; reconnect before capturing")
      mapOf("bootId" to "android-$boot", "elapsedMs" to SystemClock.elapsedRealtime().toDouble())
    }
    AsyncFunction("inspect") { uri: String ->
      val path = Uri.parse(uri).path ?: error("Invalid local image")
      val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
      BitmapFactory.decodeFile(path, bounds)
      if (bounds.outWidth < 1 || bounds.outHeight < 1) error("Unable to decode photo")
      val options = BitmapFactory.Options().apply { inSampleSize = maxOf(1, maxOf(bounds.outWidth, bounds.outHeight) / 128) }
      val bitmap = BitmapFactory.decodeFile(path, options) ?: error("Unable to decode photo")
      try {
        val w = bitmap.width; val h = bitmap.height
        val pixels = IntArray(w * h); bitmap.getPixels(pixels, 0, w, 0, 0, w, h)
        val luma = DoubleArray(pixels.size) { i ->
          val p = pixels[i]; .2126 * ((p shr 16) and 255) + .7152 * ((p shr 8) and 255) + .0722 * (p and 255)
        }
        var sum = 0.0; var sumSq = 0.0; var n = 0
        for (y in 1 until h - 1) for (x in 1 until w - 1) {
          val i = y * w + x
          val v = luma[i - 1] + luma[i + 1] + luma[i - w] + luma[i + w] - 4 * luma[i]
          sum += v; sumSq += v * v; n++
        }
        val variance = if (n > 0) maxOf(0.0, sumSq / n - (sum / n) * (sum / n)) else 0.0
        mapOf("luminance" to luma.average(), "laplacianVariance" to variance,
          "clipping" to luma.count { it < 5 || it > 250 }.toDouble() / luma.size,
          "width" to bounds.outWidth, "height" to bounds.outHeight)
      } finally { bitmap.recycle() }
    }
  }
}
