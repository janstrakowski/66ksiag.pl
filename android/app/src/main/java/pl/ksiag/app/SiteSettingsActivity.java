package pl.ksiag.app;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;

import com.google.androidbrowserhelper.trusted.ManageDataLauncherActivity;

/**
 * Otwiera ustawienia strony TWA (m.in. powiadomienia pochodzenia 66ksiag.pl).
 * Wywoływane z PWA: ksiag://site-settings
 *
 * Sam przełącznik Androida (POST_NOTIFICATIONS) nie odblokowuje
 * Notification.permission === "denied" w Chrome — trzeba Zezwól w Site settings.
 */
public class SiteSettingsActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Intent intent = new Intent(this, ManageDataLauncherActivity.class);
        intent.setAction(Intent.ACTION_APPLICATION_PREFERENCES);
        try {
            startActivity(intent);
        } catch (Exception e) {
            // Awaryjnie: szczegóły aplikacji systemowe
            Intent fallback = new Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            fallback.setData(android.net.Uri.fromParts("package", getPackageName(), null));
            fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            try {
                startActivity(fallback);
            } catch (Exception ignored) {
                /* ignore */
            }
        }
        finish();
    }
}
