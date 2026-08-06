package com.gaganrealtech.crm;

import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;

@CapacitorPlugin(name = "AppUpdater")
public class AppUpdaterPlugin extends Plugin {

    private long downloadId = -1;
    private BroadcastReceiver onDownloadComplete;

    @PluginMethod
    public void getAppVersionCode(PluginCall call) {
        try {
            Context context = getContext();
            PackageManager pm = context.getPackageManager();
            PackageInfo pInfo = pm.getPackageInfo(context.getPackageName(), 0);
            long versionCode;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                versionCode = pInfo.getLongVersionCode();
            } else {
                versionCode = pInfo.versionCode;
            }
            String versionName = pInfo.versionName;

            JSObject ret = new JSObject();
            ret.put("versionCode", versionCode);
            ret.put("versionName", versionName);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Could not get version info: " + e.getMessage());
        }
    }

    @PluginMethod
    public void downloadAndInstallApk(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("URL is required");
            return;
        }

        try {
            Context context = getContext();
            
            // Delete old download if exists
            File oldFile = new File(context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "gagan_crm_update.apk");
            if (oldFile.exists()) {
                oldFile.delete();
            }

            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
            request.setTitle("Downloading CRM Update");
            request.setDescription("Downloading Gagan Realtech CRM latest version...");
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE);
            request.setDestinationInExternalFilesDir(context, Environment.DIRECTORY_DOWNLOADS, "gagan_crm_update.apk");
            
            DownloadManager downloadManager = (DownloadManager) context.getSystemService(Context.DOWNLOAD_SERVICE);
            if (downloadManager == null) {
                call.reject("DownloadManager not available");
                return;
            }

            downloadId = downloadManager.enqueue(request);

            // Register broadcast receiver for download completion
            onDownloadComplete = new BroadcastReceiver() {
                @Override
                public void onReceive(Context ctx, Intent intent) {
                    long id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1);
                    if (downloadId == id) {
                        try {
                            context.unregisterReceiver(onDownloadComplete);
                        } catch (Exception e) {
                            // Already unregistered
                        }
                        installApk(context, oldFile, call);
                    }
                }
            };
            
            context.registerReceiver(onDownloadComplete, new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE));

            // Start a thread to track download progress and notify frontend
            new Thread(new Runnable() {
                @Override
                public void run() {
                    boolean downloading = true;
                    while (downloading) {
                        DownloadManager.Query query = new DownloadManager.Query();
                        query.setFilterById(downloadId);
                        Cursor cursor = downloadManager.query(query);
                        if (cursor != null && cursor.moveToFirst()) {
                            int bytesDownloadedIndex = cursor.getColumnIndex(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR);
                            int bytesTotalIndex = cursor.getColumnIndex(DownloadManager.COLUMN_TOTAL_SIZE_BYTES);
                            int statusIndex = cursor.getColumnIndex(DownloadManager.COLUMN_STATUS);
                            
                            if (bytesDownloadedIndex != -1 && bytesTotalIndex != -1 && statusIndex != -1) {
                                int bytesDownloaded = cursor.getInt(bytesDownloadedIndex);
                                int bytesTotal = cursor.getInt(bytesTotalIndex);
                                int status = cursor.getInt(statusIndex);
                                
                                if (status == DownloadManager.STATUS_SUCCESSFUL) {
                                    downloading = false;
                                } else if (status == DownloadManager.STATUS_FAILED) {
                                    downloading = false;
                                    getActivity().runOnUiThread(new Runnable() {
                                        @Override
                                        public void run() {
                                            call.reject("Download failed");
                                        }
                                    });
                                }
                                
                                if (bytesTotal > 0) {
                                    final int progress = (int) ((bytesDownloaded * 100L) / bytesTotal);
                                    JSObject progressObj = new JSObject();
                                    progressObj.put("progress", progress);
                                    notifyListeners("downloadProgress", progressObj);
                                }
                            }
                            cursor.close();
                        }
                        try {
                            Thread.sleep(500);
                        } catch (InterruptedException e) {
                            e.printStackTrace();
                        }
                    }
                }
            }).start();

            JSObject status = new JSObject();
            status.put("status", "started");
            call.resolve(status);

        } catch (Exception e) {
            call.reject("Download initialization failed: " + e.getMessage());
        }
    }

    private void installApk(Context context, File apkFile, PluginCall call) {
        try {
            if (!apkFile.exists()) {
                call.reject("APK file not found after download");
                return;
            }

            // Request install permission on Oreo and above
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                if (!context.getPackageManager().canRequestPackageInstalls()) {
                    // Start settings screen to allow permission
                    Intent settingsIntent = new Intent(android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
                    settingsIntent.setData(Uri.parse("package:" + context.getPackageName()));
                    settingsIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    context.startActivity(settingsIntent);
                    
                    // We notify the listener that they need to grant permission
                    JSObject permissionObj = new JSObject();
                    permissionObj.put("action", "requestPermission");
                    notifyListeners("installState", permissionObj);
                    return;
                }
            }

            Uri apkUri = FileProvider.getUriForFile(
                context, 
                context.getPackageName() + ".fileprovider", 
                apkFile
            );

            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(apkUri, "application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(intent);

            JSObject stateObj = new JSObject();
            stateObj.put("action", "installed");
            notifyListeners("installState", stateObj);

        } catch (Exception e) {
            call.reject("Installation trigger failed: " + e.getMessage());
        }
    }
}
