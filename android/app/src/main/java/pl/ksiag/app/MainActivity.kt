package pl.ksiag.app

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.lifecycle.ViewModelProvider
import pl.ksiag.app.ui.KsiagRoot

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val model = ViewModelProvider(this)[KsiagModel::class.java]
        setContent { KsiagRoot(model) }
        if (savedInstanceState == null) model.openUri(intent?.data)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        ViewModelProvider(this)[KsiagModel::class.java].openUri(intent.data)
    }
}
