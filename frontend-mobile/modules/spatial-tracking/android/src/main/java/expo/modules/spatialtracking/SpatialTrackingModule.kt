package expo.modules.spatialtracking

import android.content.Context
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.graphics.Bitmap
import android.graphics.Matrix
import android.opengl.GLES20
import android.opengl.GLES11Ext
import android.opengl.GLSurfaceView
import android.os.SystemClock
import com.google.ar.core.*
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.views.ExpoView
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.UUID
import javax.microedition.khronos.egl.EGLConfig
import javax.microedition.khronos.opengles.GL10

// One owner of camera, GL texture and world for all requirement/view captures.
internal object SpatialEngine {
  var session: Session? = null
  var view: SpatialCameraView? = null
  var frame: Frame? = null
  var broken = false
  var hadGood = false
  var lostAt: Long? = null
  var lastFrameAt = 0L
  @Synchronized fun stop() {
    session?.pause(); session?.close(); session = null; frame = null; broken = true
  }
  @Synchronized fun start(context: Context) {
    if (session != null) return
    val s = Session(context)
    try {
      // Prefer an available high-resolution CPU camera stream for controlled evidence.
      val configs = s.getSupportedCameraConfigs(CameraConfigFilter(s))
      val evidenceConfig = configs.maxByOrNull { it.imageSize.width * it.imageSize.height }
        ?: error("Spatial camera configuration unavailable")
      // Many ARCore devices only expose 640x480 CPU images. Those cannot satisfy
      // the existing 600px evidence gate; use the ordinary full-resolution camera.
      check(minOf(evidenceConfig.imageSize.width, evidenceConfig.imageSize.height) >= 600) {
        "Spatial camera resolution is too low for verification photos"
      }
      s.cameraConfig = evidenceConfig
      val config = Config(s)
      config.focusMode = Config.FocusMode.AUTO
      config.planeFindingMode = Config.PlaneFindingMode.HORIZONTAL_AND_VERTICAL
      // Depth hit tests remain candidates until calibrated with fixture ground truth.
      if (s.isDepthModeSupported(Config.DepthMode.AUTOMATIC)) config.depthMode = Config.DepthMode.AUTOMATIC
      s.configure(config); s.resume()
      session = s; broken = false; hadGood = false; lostAt = null
    } catch (error: Exception) { s.close(); throw error }
  }
  fun position(p: Pose) = mapOf("x" to p.tx().toDouble(), "y" to p.ty().toDouble(), "z" to p.tz().toDouble())
  @Synchronized fun sample(): Map<String, Any?> {
    val f = frame
    if (f == null || session == null || SystemClock.elapsedRealtime() - lastFrameAt > 500) return mapOf("tracking" to "UNAVAILABLE","continuity" to "BROKEN","camera" to null,"worldPoint" to null,"nativeTimestampMs" to null)
    val state = when (f.camera.trackingState) { TrackingState.TRACKING -> "GOOD"; TrackingState.STOPPED -> "LOST"; else -> "DEGRADED" }
    val pose = f.camera.pose
    val hit = if (state == "GOOD") f.hitTest((view?.width ?: 0) / 2f, (view?.height ?: 0) / 2f).firstOrNull {
      val track = it.trackable
      (track is Plane && track.isPoseInPolygon(it.hitPose) && track.trackingState == TrackingState.TRACKING) || track is DepthPoint
    } else null
    val point = hit?.let { mapOf("position" to position(it.hitPose), "method" to if (it.trackable is DepthPoint) "CENTER_DEPTH" else "CENTER_PLANE", "quality" to "CANDIDATE", "uncertaintyMeters" to null) }
    return mapOf("tracking" to state, "continuity" to if (broken) "BROKEN" else "CONTINUOUS", "nativeTimestampMs" to f.timestamp / 1e6,
      "camera" to mapOf("position" to position(pose), "orientation" to mapOf("x" to pose.qx().toDouble(), "y" to pose.qy().toDouble(), "z" to pose.qz().toDouble(), "w" to pose.qw().toDouble())), "worldPoint" to point)
  }
  @Synchronized fun capture(context: Context): Map<String, Any?> {
    val f = frame ?: error("Camera is warming up")
    check(session != null && SystemClock.elapsedRealtime() - lastFrameAt <= 500) { "Camera is warming up" }
    val sample = sample()
    // Convert this frame's YUV CPU image locally; never retain frame sequences.
    f.acquireCameraImage().use { image ->
      check(kotlin.math.abs(image.timestamp - f.timestamp) <= 50_000_000L) { "Image/pose timing mismatch" }
      val w = image.width; val h = image.height
      val planes = image.planes
      fun channel(i: Int, x: Int, y: Int): Int = planes[i].buffer.get(y * planes[i].rowStride + x * planes[i].pixelStride).toInt() and 255
      val pixels = IntArray(w*h)
      for (y in 0 until h) for (x in 0 until w) {
        val yy = channel(0,x,y); val u = channel(1,x/2,y/2)-128; val v = channel(2,x/2,y/2)-128
        val r = (yy + 1.402*v).toInt().coerceIn(0,255)
        val g = (yy - 0.344136*u - 0.714136*v).toInt().coerceIn(0,255)
        val b = (yy + 1.772*u).toInt().coerceIn(0,255)
        // Store in sensor order; rotate using actual camera characteristics below.
        pixels[y*w+x] = (255 shl 24) or (r shl 16) or (g shl 8) or b
      }
      val sensor = Bitmap.createBitmap(pixels,w,h,Bitmap.Config.ARGB_8888)
      val manager = context.getSystemService(Context.CAMERA_SERVICE) as CameraManager
      val orientation = manager.getCameraCharacteristics(session!!.cameraConfig.cameraId).get(CameraCharacteristics.SENSOR_ORIENTATION) ?: 90
      val bitmap = Bitmap.createBitmap(sensor,0,0,w,h,Matrix().apply { postRotate(orientation.toFloat()) },true)
      if (sensor !== bitmap) sensor.recycle()
      val directory = File(context.cacheDir,"Camera").apply { mkdirs() }
      val file = File(directory,"spatial-${UUID.randomUUID()}.jpg")
      try { file.outputStream().use { check(bitmap.compress(Bitmap.CompressFormat.JPEG,90,it)) } }
      finally { bitmap.recycle() }
      return mapOf("uri" to android.net.Uri.fromFile(file).toString(), "sample" to sample)
    }
  }
}

class SpatialTrackingModule: Module() {
  override fun definition() = ModuleDefinition {
    Name("SpatialTracking")
    AsyncFunction("isSupported") {
      val context = appContext.reactContext ?: return@AsyncFunction "NO_SPATIAL"
      // Missing/outdated AR services use fallback; no unsolicited install flow.
      if (ArCoreApk.getInstance().checkAvailability(context) == ArCoreApk.Availability.SUPPORTED_INSTALLED) "LIMITED_SPATIAL" else "NO_SPATIAL"
    }
    AsyncFunction("start") { SpatialEngine.start(appContext.reactContext ?: error("Context unavailable")) }
    AsyncFunction("stop") { SpatialEngine.stop() }
    AsyncFunction("interrupt") { SpatialEngine.stop() }
    AsyncFunction("getTrackingState") { SpatialEngine.sample() }
    AsyncFunction("captureSpatialObservation") { promise: Promise ->
      val view = SpatialEngine.view
      if (view == null) promise.reject("SPATIAL_NOT_READY","Camera is warming up",null)
      else view.gl.queueEvent {
        try { promise.resolve(SpatialEngine.capture(view.context)) }
        catch (error: Exception) { promise.reject("SPATIAL_CAPTURE",error.message,error) }
      }
    }
    OnActivityEntersBackground { SpatialEngine.stop() }
    OnDestroy { SpatialEngine.stop() }
    View(SpatialCameraView::class) {}
  }
}

class SpatialCameraView(context: Context, appContext: AppContext): ExpoView(context,appContext), GLSurfaceView.Renderer {
  val gl = GLSurfaceView(context)
  private var texture = 0
  private var program = 0
  private val vertices = floats(floatArrayOf(-1f,-1f,1f,-1f,-1f,1f,1f,1f))
  private val uv = floats(FloatArray(8))
  init { gl.setEGLContextClientVersion(2); gl.preserveEGLContextOnPause = true; gl.setRenderer(this); addView(gl,LayoutParams(LayoutParams.MATCH_PARENT,LayoutParams.MATCH_PARENT)); SpatialEngine.view = this }
  private fun floats(values: FloatArray) = ByteBuffer.allocateDirect(values.size*4).order(ByteOrder.nativeOrder()).asFloatBuffer().apply { put(values); position(0) }
  private fun shader(kind:Int, code:String):Int = GLES20.glCreateShader(kind).also { GLES20.glShaderSource(it,code); GLES20.glCompileShader(it) }
  override fun onSurfaceCreated(unused:GL10?, config:EGLConfig?) {
    val names = IntArray(1); GLES20.glGenTextures(1,names,0); texture = names[0]
    GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES,texture)
    GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES,GLES20.GL_TEXTURE_MIN_FILTER,GLES20.GL_LINEAR)
    GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES,GLES20.GL_TEXTURE_MAG_FILTER,GLES20.GL_LINEAR)
    GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES,GLES20.GL_TEXTURE_WRAP_S,GLES20.GL_CLAMP_TO_EDGE)
    GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES,GLES20.GL_TEXTURE_WRAP_T,GLES20.GL_CLAMP_TO_EDGE)
    program = GLES20.glCreateProgram()
    GLES20.glAttachShader(program,shader(GLES20.GL_VERTEX_SHADER,"attribute vec2 p; attribute vec2 t; varying vec2 uv; void main(){gl_Position=vec4(p,0.,1.);uv=t;}"))
    GLES20.glAttachShader(program,shader(GLES20.GL_FRAGMENT_SHADER,"#extension GL_OES_EGL_image_external : require\nprecision mediump float; uniform samplerExternalOES camera; varying vec2 uv; void main(){gl_FragColor=texture2D(camera,uv);}"))
    GLES20.glLinkProgram(program)
  }
  override fun onSurfaceChanged(unused:GL10?, width:Int, height:Int) { GLES20.glViewport(0,0,width,height) }
  override fun onDrawFrame(unused:GL10?) {
    synchronized(SpatialEngine) {
      val session = SpatialEngine.session ?: return
      try {
        session.setCameraTextureName(texture)
        @Suppress("DEPRECATION")
        val rotation = (context.getSystemService(Context.WINDOW_SERVICE) as android.view.WindowManager).defaultDisplay.rotation
        session.setDisplayGeometry(rotation,width,height)
        val frame = session.update(); if (frame.timestamp == 0L) return
        SpatialEngine.frame = frame; SpatialEngine.lastFrameAt = SystemClock.elapsedRealtime()
        if (frame.camera.trackingState == TrackingState.TRACKING) { SpatialEngine.hadGood = true; SpatialEngine.lostAt = null }
        else if (SpatialEngine.hadGood) {
          val now = SystemClock.elapsedRealtime(); if (SpatialEngine.lostAt == null) SpatialEngine.lostAt = now
          if (now - (SpatialEngine.lostAt ?: now) > 3000) SpatialEngine.broken = true
        }
        uv.position(0)
        frame.transformCoordinates2d(Coordinates2d.OPENGL_NORMALIZED_DEVICE_COORDINATES,vertices,Coordinates2d.TEXTURE_NORMALIZED,uv)
        GLES20.glUseProgram(program); GLES20.glActiveTexture(GLES20.GL_TEXTURE0); GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES,texture)
        GLES20.glUniform1i(GLES20.glGetUniformLocation(program,"camera"),0)
        fun attribute(name:String, data:java.nio.FloatBuffer) { val index = GLES20.glGetAttribLocation(program,name); data.position(0); GLES20.glEnableVertexAttribArray(index); GLES20.glVertexAttribPointer(index,2,GLES20.GL_FLOAT,false,0,data) }
        attribute("p",vertices); attribute("t",uv); GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP,0,4)
      } catch (error: Exception) { SpatialEngine.stop() }
    }
  }
  override fun onDetachedFromWindow() { SpatialEngine.stop(); if (SpatialEngine.view === this) SpatialEngine.view = null; gl.onPause(); super.onDetachedFromWindow() }
  override fun onAttachedToWindow() { super.onAttachedToWindow(); SpatialEngine.view = this; gl.onResume() }
}
