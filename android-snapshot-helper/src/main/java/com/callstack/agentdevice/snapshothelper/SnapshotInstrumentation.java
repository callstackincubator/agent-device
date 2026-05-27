package com.callstack.agentdevice.snapshothelper;

import android.accessibilityservice.AccessibilityServiceInfo;
import android.app.Instrumentation;
import android.app.UiAutomation;
import android.graphics.Rect;
import android.os.Bundle;
import android.util.Base64;
import android.view.accessibility.AccessibilityNodeInfo;
import android.view.accessibility.AccessibilityWindowInfo;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.lang.reflect.Field;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.TimeoutException;

public final class SnapshotInstrumentation extends Instrumentation {
  private static final String PROTOCOL = "android-snapshot-helper-v1";
  private static final String OUTPUT_FORMAT = "uiautomator-xml";
  private static final String HELPER_API_VERSION = "1";
  private static final int CHUNK_SIZE = 2 * 1024;
  private static final long DEFAULT_WAIT_FOR_IDLE_TIMEOUT_MS = 500;
  private static final long DEFAULT_WAIT_FOR_IDLE_QUIET_MS = 100;
  private static final long DEFAULT_TIMEOUT_MS = 8_000;
  private static final int DEFAULT_MAX_DEPTH = 128;
  private static final int DEFAULT_MAX_NODES = 5_000;
  private Bundle arguments;

  @Override
  public void onCreate(Bundle arguments) {
    super.onCreate(arguments);
    this.arguments = arguments;
    start();
  }

  @Override
  public void onStart() {
    super.onStart();
    long waitForIdleTimeoutMs =
        readLongArgument(arguments, "waitForIdleTimeoutMs", DEFAULT_WAIT_FOR_IDLE_TIMEOUT_MS);
    long waitForIdleQuietMs =
        readLongArgument(arguments, "waitForIdleQuietMs", DEFAULT_WAIT_FOR_IDLE_QUIET_MS);
    long timeoutMs = readLongArgument(arguments, "timeoutMs", DEFAULT_TIMEOUT_MS);
    int maxDepth = readIntArgument(arguments, "maxDepth", DEFAULT_MAX_DEPTH);
    int maxNodes = readIntArgument(arguments, "maxNodes", DEFAULT_MAX_NODES);
    String outputPath = readStringArgument(arguments, "outputPath");
    Bundle result = new Bundle();
    result.putString("agentDeviceProtocol", PROTOCOL);
    result.putString("helperApiVersion", HELPER_API_VERSION);
    result.putString("outputFormat", OUTPUT_FORMAT);
    result.putString("waitForIdleTimeoutMs", Long.toString(waitForIdleTimeoutMs));
    result.putString("waitForIdleQuietMs", Long.toString(waitForIdleQuietMs));
    result.putString("timeoutMs", Long.toString(timeoutMs));
    result.putString("maxDepth", Integer.toString(maxDepth));
    result.putString("maxNodes", Integer.toString(maxNodes));

    try {
      long startedAtMs = System.currentTimeMillis();
      CaptureResult capture =
          captureXml(waitForIdleQuietMs, waitForIdleTimeoutMs, timeoutMs, maxDepth, maxNodes);
      writeOutputFile(outputPath, capture.xml);
      emitChunks(capture.xml);
      result.putString("ok", "true");
      result.putString("rootPresent", Boolean.toString(capture.rootPresent));
      result.putString("captureMode", capture.captureMode);
      result.putString("windowCount", Integer.toString(capture.windowCount));
      result.putString("nodeCount", Integer.toString(capture.nodeCount));
      result.putString("truncated", Boolean.toString(capture.truncated));
      result.putString("elapsedMs", Long.toString(System.currentTimeMillis() - startedAtMs));
      finishSafely(0, result);
    } catch (Throwable error) {
      result.putString("ok", "false");
      result.putString("errorType", error.getClass().getName());
      result.putString(
          "message",
          error.getMessage() == null ? error.getClass().getName() : error.getMessage());
      finishSafely(1, result);
    }
  }

  private static String readStringArgument(Bundle arguments, String key) {
    if (arguments == null || !arguments.containsKey(key)) {
      return null;
    }
    String value = arguments.getString(key);
    return value == null || value.trim().isEmpty() ? null : value.trim();
  }

  private static void writeOutputFile(String outputPath, String xml) throws IOException {
    if (outputPath == null) {
      return;
    }
    File file = new File(outputPath);
    File parent = file.getParentFile();
    if (parent != null) {
      parent.mkdirs();
    }
    try (FileOutputStream stream = new FileOutputStream(file, false)) {
      stream.write(xml.getBytes(StandardCharsets.UTF_8));
    }
  }

  private void finishSafely(int resultCode, Bundle result) {
    RuntimeException lastError = null;
    for (int attempt = 0; attempt < 100; attempt += 1) {
      try {
        finish(resultCode, result);
        return;
      } catch (IllegalStateException error) {
        if (!isUiAutomationConnectingError(error)) {
          throw error;
        }
        lastError = error;
        sleep(100);
      }
    }
    detachUiAutomationBeforeFinish();
    try {
      finish(resultCode, result);
      return;
    } catch (IllegalStateException error) {
      if (!isUiAutomationConnectingError(error)) {
        throw error;
      }
      lastError = error;
    }
    throw lastError;
  }

  private void detachUiAutomationBeforeFinish() {
    try {
      Field field = Instrumentation.class.getDeclaredField("mUiAutomation");
      field.setAccessible(true);
      field.set(this, null);
    } catch (ReflectiveOperationException | RuntimeException ignored) {
      // If the platform blocks reflection, preserve the original finish failure below.
    }
  }

  private static boolean isUiAutomationConnectingError(IllegalStateException error) {
    String message = error.getMessage();
    return message != null && message.contains("while connecting");
  }

  private static boolean isUiAutomationNotConnectedError(IllegalStateException error) {
    String message = error.getMessage();
    return message != null && message.toLowerCase(Locale.ROOT).contains("not connected");
  }

  private static void sleep(long millis) {
    try {
      Thread.sleep(millis);
    } catch (InterruptedException error) {
      Thread.currentThread().interrupt();
    }
  }

  @SuppressWarnings("deprecation")
  private CaptureResult captureXml(
      long waitForIdleQuietMs,
      long waitForIdleTimeoutMs,
      long timeoutMs,
      int maxDepth,
      int maxNodes)
      throws TimeoutException {
    UiAutomation automation = getConnectedUiAutomation(timeoutMs);
    enableInteractiveWindowRetrieval(automation);
    if (waitForIdleTimeoutMs > 0) {
      try {
        // Best-effort settle: wait for the accessibility stream to become idle, but require only
        // a short quiet window once it does. Using the full timeout as the quiet window made every
        // stable snapshot pay a fixed 500 ms tax.
        long quietMs = Math.min(waitForIdleQuietMs, waitForIdleTimeoutMs);
        automation.waitForIdle(quietMs, waitForIdleTimeoutMs);
      } catch (TimeoutException ignored) {
        // Busy or animated apps can still expose a usable root; capture whatever is available.
      }
    }

    CaptureStats stats = new CaptureStats();
    StringBuilder xml = new StringBuilder();
    xml.append("<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>");
    xml.append("<hierarchy rotation=\"0\">");
    int windowCount = appendInteractiveWindowRoots(xml, automation, maxDepth, maxNodes, stats);
    String captureMode = "interactive-windows";
    if (windowCount == 0) {
      AccessibilityNodeInfo root = automation.getRootInActiveWindow();
      try {
        if (root != null) {
          appendNode(xml, root, 0, 0, maxDepth, maxNodes, stats);
          windowCount = 1;
        }
        captureMode = "active-window";
      } finally {
        if (root != null) {
          root.recycle();
        }
      }
    }
    xml.append("</hierarchy>");
    return new CaptureResult(
        xml.toString(), windowCount > 0, captureMode, windowCount, stats.nodeCount, stats.truncated);
  }

  private UiAutomation getConnectedUiAutomation(long timeoutMs) throws TimeoutException {
    long deadlineMs = System.currentTimeMillis() + Math.max(1, timeoutMs);
    UiAutomation automation = getUiAutomation();
    RuntimeException lastError = null;
    while (System.currentTimeMillis() <= deadlineMs) {
      try {
        automation.getServiceInfo();
        return automation;
      } catch (IllegalStateException error) {
        if (!isUiAutomationConnectingError(error) && !isUiAutomationNotConnectedError(error)) {
          throw error;
        }
        lastError = error;
      }
      sleep(50);
    }
    TimeoutException timeout =
        new TimeoutException("Timed out waiting for Android UiAutomation to connect");
    if (lastError != null) {
      timeout.initCause(lastError);
    }
    throw timeout;
  }

  private static void enableInteractiveWindowRetrieval(UiAutomation automation) {
    AccessibilityServiceInfo serviceInfo;
    try {
      serviceInfo = automation.getServiceInfo();
    } catch (RuntimeException error) {
      return;
    }
    if (serviceInfo == null) {
      return;
    }
    if ((serviceInfo.flags & AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS) != 0) {
      return;
    }
    serviceInfo.flags |= AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS;
    try {
      automation.setServiceInfo(serviceInfo);
    } catch (RuntimeException ignored) {
      // Fall back to active-window capture if the platform rejects dynamic service flags.
    }
  }

  @SuppressWarnings("deprecation")
  private static int appendInteractiveWindowRoots(
      StringBuilder xml,
      UiAutomation automation,
      int maxDepth,
      int maxNodes,
      CaptureStats stats) {
    List<AccessibilityWindowInfo> windows;
    try {
      windows = automation.getWindows();
    } catch (RuntimeException error) {
      return 0;
    }
    int windowCount = 0;
    for (int index = 0; index < windows.size(); index += 1) {
      if (stats.nodeCount >= maxNodes) {
        stats.truncated = true;
        break;
      }
      AccessibilityWindowInfo window = windows.get(index);
      AccessibilityNodeInfo root = null;
      try {
        root = window.getRoot();
        if (root == null) {
          continue;
        }
        StringBuilder windowXml = new StringBuilder();
        CaptureStats windowStats = stats.copy();
        appendNode(windowXml, root, windowCount, 0, maxDepth, maxNodes, windowStats);
        xml.append(windowXml);
        stats.copyFrom(windowStats);
        windowCount += 1;
      } catch (RuntimeException ignored) {
        // Accessibility windows can disappear while traversing; keep the rest of the snapshot.
      } finally {
        if (root != null) {
          root.recycle();
        }
        // UiAutomation.getWindows() transfers recyclable AccessibilityWindowInfo instances.
        window.recycle();
      }
    }
    return windowCount;
  }

  private void emitChunks(String payload) {
    byte[] bytes = payload.getBytes(StandardCharsets.UTF_8);
    int chunkCount = Math.max(1, (bytes.length + CHUNK_SIZE - 1) / CHUNK_SIZE);
    for (int index = 0; index < chunkCount; index += 1) {
      int start = index * CHUNK_SIZE;
      int end = Math.min(bytes.length, start + CHUNK_SIZE);
      Bundle status = new Bundle();
      status.putString("agentDeviceProtocol", PROTOCOL);
      status.putString("helperApiVersion", HELPER_API_VERSION);
      status.putString("outputFormat", OUTPUT_FORMAT);
      status.putString("chunkIndex", Integer.toString(index));
      status.putString("chunkCount", Integer.toString(chunkCount));
      status.putString(
          "payloadBase64", Base64.encodeToString(bytes, start, end - start, Base64.NO_WRAP));
      sendStatus(1, status);
    }
  }

  @SuppressWarnings("deprecation")
  private static void appendNode(
      StringBuilder xml,
      AccessibilityNodeInfo node,
      int nodeIndex,
      int depth,
      int maxDepth,
      int maxNodes,
      CaptureStats stats) {
    if (stats.nodeCount >= maxNodes) {
      stats.truncated = true;
      return;
    }
    stats.nodeCount += 1;
    Rect bounds = new Rect();
    node.getBoundsInScreen(bounds);
    xml.append("<node");
    appendAttribute(xml, "index", Integer.toString(nodeIndex));
    appendAttribute(xml, "text", node.getText());
    appendAttribute(xml, "resource-id", node.getViewIdResourceName());
    appendAttribute(xml, "class", node.getClassName());
    appendAttribute(xml, "package", node.getPackageName());
    appendAttribute(xml, "content-desc", node.getContentDescription());
    appendAttribute(xml, "checkable", Boolean.toString(node.isCheckable()));
    appendAttribute(xml, "checked", Boolean.toString(node.isChecked()));
    appendAttribute(xml, "clickable", Boolean.toString(node.isClickable()));
    appendAttribute(xml, "enabled", Boolean.toString(node.isEnabled()));
    appendAttribute(xml, "focusable", Boolean.toString(node.isFocusable()));
    appendAttribute(xml, "focused", Boolean.toString(node.isFocused()));
    appendAttribute(xml, "scrollable", Boolean.toString(node.isScrollable()));
    appendAttribute(xml, "long-clickable", Boolean.toString(node.isLongClickable()));
    appendAttribute(xml, "password", Boolean.toString(node.isPassword()));
    appendAttribute(xml, "selected", Boolean.toString(node.isSelected()));
    appendAttribute(
        xml,
        "bounds",
        String.format(
            Locale.ROOT,
            "[%d,%d][%d,%d]",
            bounds.left,
            bounds.top,
            bounds.right,
            bounds.bottom));

    int childCount = depth >= maxDepth ? 0 : node.getChildCount();
    if (depth >= maxDepth && node.getChildCount() > 0) {
      stats.truncated = true;
    }
    if (childCount <= 0) {
      xml.append(" />");
      return;
    }

    xml.append(">");
    for (int index = 0; index < childCount; index += 1) {
      if (stats.nodeCount >= maxNodes) {
        stats.truncated = true;
        break;
      }
      AccessibilityNodeInfo child = node.getChild(index);
      if (child == null) {
        continue;
      }
      try {
        appendNode(xml, child, index, depth + 1, maxDepth, maxNodes, stats);
      } finally {
        child.recycle();
      }
    }
    xml.append("</node>");
  }

  private static void appendAttribute(StringBuilder xml, String name, CharSequence value) {
    String stringValue = value == null ? "" : value.toString();
    xml.append(' ');
    xml.append(name);
    xml.append("=\"");
    appendEscaped(xml, stringValue);
    xml.append('"');
  }

  private static void appendEscaped(StringBuilder xml, String value) {
    for (int index = 0; index < value.length(); index += 1) {
      char character = value.charAt(index);
      switch (character) {
        case '&':
          xml.append("&amp;");
          break;
        case '<':
          xml.append("&lt;");
          break;
        case '>':
          xml.append("&gt;");
          break;
        case '"':
          xml.append("&quot;");
          break;
        case '\'':
          xml.append("&apos;");
          break;
        case '\n':
          xml.append("&#10;");
          break;
        case '\r':
          xml.append("&#13;");
          break;
        case '\t':
          xml.append("&#9;");
          break;
        default:
          xml.append(character);
          break;
      }
    }
  }

  private static long readLongArgument(Bundle arguments, String name, long fallback) {
    if (arguments == null) {
      return fallback;
    }
    String raw = arguments.getString(name);
    if (raw == null || raw.trim().isEmpty()) {
      return fallback;
    }
    try {
      return Math.max(0, Long.parseLong(raw.trim()));
    } catch (NumberFormatException error) {
      return fallback;
    }
  }

  private static int readIntArgument(Bundle arguments, String name, int fallback) {
    if (arguments == null) {
      return fallback;
    }
    String raw = arguments.getString(name);
    if (raw == null || raw.trim().isEmpty()) {
      return fallback;
    }
    try {
      return Math.max(0, Integer.parseInt(raw.trim()));
    } catch (NumberFormatException error) {
      return fallback;
    }
  }

  private static final class CaptureStats {
    int nodeCount;
    boolean truncated;

    CaptureStats copy() {
      CaptureStats next = new CaptureStats();
      next.nodeCount = nodeCount;
      next.truncated = truncated;
      return next;
    }

    void copyFrom(CaptureStats next) {
      nodeCount = next.nodeCount;
      truncated = next.truncated;
    }
  }

  private static final class CaptureResult {
    final String xml;
    final boolean rootPresent;
    final String captureMode;
    final int windowCount;
    final int nodeCount;
    final boolean truncated;

    CaptureResult(
        String xml,
        boolean rootPresent,
        String captureMode,
        int windowCount,
        int nodeCount,
        boolean truncated) {
      this.xml = xml;
      this.rootPresent = rootPresent;
      this.captureMode = captureMode;
      this.windowCount = windowCount;
      this.nodeCount = nodeCount;
      this.truncated = truncated;
    }
  }
}
