package pl.ksiag.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.os.Build;

public class Application extends android.app.Application {
    public static final String CHANNEL_PLAN = "ksiag_plan";
    public static final String CHANNEL_AUDIO = "ksiag_audio";

    @Override
    public void onCreate() {
        super.onCreate();
        ensureChannels();
    }

    void ensureChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm == null) return;

        NotificationChannel plan = new NotificationChannel(
            CHANNEL_PLAN,
            "Plan dzienny",
            NotificationManager.IMPORTANCE_DEFAULT
        );
        plan.setDescription("Przypomnienia o czytaniu i postęp planu");
        nm.createNotificationChannel(plan);

        NotificationChannel audio = new NotificationChannel(
            CHANNEL_AUDIO,
            "Audio KJV",
            NotificationManager.IMPORTANCE_LOW
        );
        audio.setDescription("Pobieranie audio Scourby");
        nm.createNotificationChannel(audio);
    }
}
