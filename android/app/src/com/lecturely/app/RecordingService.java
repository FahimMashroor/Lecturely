package com.lecturely.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

/**
 * Keeps Lecturely working while it is in the background or the screen is off.
 *
 * Android stops apps that are out of sight from using the microphone, and lets
 * the phone's processor fall asleep. A "foreground service" is Android's
 * official way to say "this app is doing something the person asked for right
 * now": Android then lets it keep recording, and in return the app must show a
 * notification so the person always knows. The "wake lock" keeps the processor
 * awake (the screen may still turn off) so the transcript keeps being written.
 */
public class RecordingService extends Service {
    private static final String CHANNEL = "recording";
    private static final int NOTE_ID = 1;
    static final String EXTRA_STATUS = "status";

    private static RecordingService running;
    private PowerManager.WakeLock wake;

    /** Starts the service, or just changes its notification text. "" stops it. */
    static void show(Context ctx, String status) {
        if (status == null || status.isEmpty()) {
            ctx.stopService(new Intent(ctx, RecordingService.class));
            return;
        }
        if (running != null) {
            running.update(status);
            return;
        }
        Intent i = new Intent(ctx, RecordingService.class).putExtra(EXTRA_STATUS, status);
        if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i);
        else ctx.startService(i);
    }

    @Override
    public void onCreate() {
        super.onCreate();
        running = this;
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Recording", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Shown while Lecturely records or writes a lecture");
            ch.setShowBadge(false);
            ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).createNotificationChannel(ch);
        }
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        wake = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Lecturely:recording");
        wake.setReferenceCounted(false);
        // A safety limit: the lock lets go by itself after 6 hours, even if something goes wrong.
        wake.acquire(6L * 60 * 60 * 1000);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String status = intent != null ? intent.getStringExtra(EXTRA_STATUS) : null;
        Notification n = build(status == null ? "Recording your lecture" : status);
        try {
            if (Build.VERSION.SDK_INT >= 29) startForeground(NOTE_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
            else startForeground(NOTE_ID, n);
        } catch (Exception e) {
            // Android refused (for example the microphone permission was taken away).
            stopSelf();
        }
        // If Android ever ends the app, don't restart this by itself.
        return START_NOT_STICKY;
    }

    private void update(String status) {
        ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).notify(NOTE_ID, build(status));
    }

    private Notification build(String status) {
        Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent tap = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
        b.setSmallIcon(R.drawable.ic_note)
                .setContentTitle("Lecturely")
                .setContentText(status + ". Tap to open.")
                .setContentIntent(tap)
                .setOngoing(true)
                .setShowWhen(false)
                .setOnlyAlertOnce(true);
        if (Build.VERSION.SDK_INT >= 31) b.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE);
        return b.build();
    }

    @Override
    public void onDestroy() {
        if (running == this) running = null;
        if (wake != null && wake.isHeld()) wake.release();
        stopForeground(true);
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
