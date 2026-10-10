package pl.ksiag.app;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;

/**
 * Otwiera systemowe ustawienia powiadomień tej aplikacji.
 * Wywoływane z PWA/TWA przez ksiag://notification-settings
 */
public class NotificationSettingsActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Intent intent = new Intent();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            intent.setAction(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
            intent.putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName());
        } else {
            intent.setAction(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            intent.setData(Uri.fromParts("package", getPackageName(), null));
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            startActivity(intent);
        } catch (Exception e) {
            Intent fallback = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            fallback.setData(Uri.fromParts("package", getPackageName(), null));
            fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            try {
                startActivity(fallback);
            } catch (Exception ignored) {
                /* brak Activity — nic do zrobienia */
            }
        }
        finish();
    }
}
