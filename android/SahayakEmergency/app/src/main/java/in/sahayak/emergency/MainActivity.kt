package in.sahayak.emergency

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat

class MainActivity : ComponentActivity() {
    private val permissionRequest = 40

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val status = TextView(this).apply {
            text = "Emergency Voice Mode is disabled.\nEnable only when you want hands-free emergency commands."
            setPadding(32, 48, 32, 24)
        }
        val toggle = Button(this).apply { text = "Enable Emergency Voice Mode" }
        toggle.setOnClickListener {
            if (!hasRequiredPermissions()) {
                ActivityCompat.requestPermissions(
                    this,
                    arrayOf(
                        Manifest.permission.RECORD_AUDIO,
                        Manifest.permission.ACCESS_FINE_LOCATION,
                        Manifest.permission.ACCESS_COARSE_LOCATION,
                        Manifest.permission.POST_NOTIFICATIONS,
                    ),
                    permissionRequest,
                )
                return@setOnClickListener
            }
            ContextCompat.startForegroundService(this, Intent(this, EmergencyVoiceService::class.java))
            status.text = "Emergency Voice Mode enabled. Disable it from this app to stop the service."
            toggle.text = "Disable Emergency Voice Mode"
            toggle.setOnClickListener {
                stopService(Intent(this, EmergencyVoiceService::class.java))
                status.text = "Emergency Voice Mode is disabled."
                toggle.text = "Enable Emergency Voice Mode"
            }
        }
        setContentView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            addView(status)
            addView(toggle)
        })
    }

    private fun hasRequiredPermissions(): Boolean =
        ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
}
