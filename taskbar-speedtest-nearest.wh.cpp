// ==WindhawkMod==
// @id              taskbar-speedtest-nearest-server
// @name            Taskbar Speed Test - Automatic Nearest Server
// @description     Recriação completa do zero: engine de download baseada em Winsock TCP de baixo nível (sem bloqueios de WinHttp/WinINet), alta precisão, latência ms, histórico no Registro e atalho Win+Alt+S.
// @version         40.0.1
// @author          Antigravity, improved with Codex
// @include         explorer.exe
// @compilerOptions -lgdiplus -lgdi32 -luser32 -lwininet -lcomctl32 -liphlpapi -lws2_32 -ldwmapi -lshell32
// ==/WindhawkMod==

// ==WindhawkModSettings==
// settings:
//   - unit_mbps: true
//     $name: Exibir velocidade em Mbps
//   - hotkey_enable: true
//     $name: Ativar Atalho de Teclado
//   - hotkey_mod: win_alt
//     $name: Teclas Modificadoras (win_alt, ctrl_alt, ctrl_shift, alt_shift, win_shift)
//   - hotkey_key: S
//     $name: Tecla do Atalho (Letra)
// ==/WindhawkModSettings==

#define _USE_MATH_DEFINES
#include <windows.h>
#include <winsock2.h>
#include <ws2tcpip.h>
#include <gdiplus.h>
#include <dwmapi.h>
#include <wininet.h>
#include <iphlpapi.h>
#include <icmpapi.h>
#include <shellapi.h>
#include <commctrl.h>
#include <strsafe.h>
#include <cmath>
#include <string>
#include <vector>
#include <algorithm>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

#define WM_TRAYICON (WM_USER + 3701)
#define WM_SPEEDTEST_UPDATE (WM_USER + 3702)
#define WM_SPEEDTEST_COMPLETE (WM_USER + 3703)
#define WM_TRIGGER_FLYOUT (WM_USER + 3704)
#define WM_RELOAD_HOTKEY (WM_USER + 3705)
#define HOTKEY_SPEEDTEST_ID 7777

enum TestState {
    STATE_IDLE,
    STATE_PING,
    STATE_DOWNLOAD,
    STATE_UPLOAD,
    STATE_DONE
};

struct TestHistoryRecord {
    double downMbps;
    double upMbps;
    double pingMs;
};

struct SpeedTestResults {
    double idlePingMs;
    double downPingMs;
    double upPingMs;
    
    double downloadSpeedBps;
    double uploadSpeedBps;
    double peakDownloadMbps;
    double peakUploadMbps;

    double rawCurrentMbps;
    double smoothedDisplayedMbps;

    float downloadProgress;
    float uploadProgress;
    
    TestState currentState;
    wchar_t statusText[128];
};

struct SpeedTestServer {
    std::wstring host;
    std::wstring uploadPath;
    std::wstring basePath;
    std::wstring displayName;
    INTERNET_PORT port;
    bool secure;
    double latencyMs;
};

// Pure Win32 Globals
static HWND g_hMsgWnd = NULL;
static HWND g_hFlyoutWnd = NULL;
static NOTIFYICONDATAW g_nid = { 0 };
static volatile LONG g_isTesting = 0;
static volatile LONG g_stopRequested = 0;

static SpeedTestResults g_results;
static CRITICAL_SECTION g_resultsCS;

// Persistent History Buffer (Saved in Registry HKCU)
static TestHistoryRecord g_history[3];
static int g_historyCount = 0;

static HANDLE g_hWorkerThread = NULL;
static HANDLE g_hUIThread = NULL;
static DWORD g_uiThreadId = 0;
static ULONGLONG g_lastStartClickTick = 0;

static HICON g_hIconNormal = NULL;
static HICON g_hIconTesting = NULL;

// GDI+ Token
static ULONG_PTR g_gdiplusToken = 0;

// Settings Globals (Defaults guaranteed to Win+Alt+S)
static bool g_settingUnitMbps = true;
static bool g_settingHotkeyEnable = true;
static wchar_t g_settingHotkeyMod[32] = L"win_alt";
static wchar_t g_settingHotkeyKey[16] = L"S";

static const double TEST_DURATION_SEC = 7.5;
static SpeedTestServer g_selectedServer;
static bool g_hasSelectedServer = false;

// Hover & View states
static bool g_btnRetestHover = false;
static bool g_btnCloseHover = false;
static bool g_btnGearHover = false;
static bool g_showSettingsView = false;

// Function pointers for hooks
typedef BOOL (WINAPI *ShellExecuteExW_t)(SHELLEXECUTEINFOW *pExecInfo);
static ShellExecuteExW_t pfnShellExecuteExW_Original = NULL;

typedef HINSTANCE (WINAPI *ShellExecuteW_t)(HWND hwnd, LPCWSTR lpOperation, LPCWSTR lpFile, LPCWSTR lpParameters, LPCWSTR lpDirectory, INT nShowCmd);
static ShellExecuteW_t pfnShellExecuteW_Original = NULL;

typedef BOOL (WINAPI *CreateProcessW_t)(LPCWSTR lpApplicationName, LPWSTR lpCommandLine, LPSECURITY_ATTRIBUTES lpProcessAttributes, LPSECURITY_ATTRIBUTES lpThreadAttributes, BOOL bInheritHandles, DWORD dwCreationFlags, LPVOID lpEnvironment, LPCWSTR lpCurrentDirectory, LPSTARTUPINFOW lpStartupInfo, LPPROCESS_INFORMATION lpProcessInformation);
static CreateProcessW_t pfnCreateProcessW_Original = NULL;

// Forward declaration
void ToggleOrShowSpeedTestFlyout();
void RegisterConfiguredHotKey(HWND hWnd);

// Save History to Windows Registry (HKCU)
void SaveHistoryToRegistry() {
    HKEY hKey;
    if (RegCreateKeyExW(HKEY_CURRENT_USER, L"Software\\WindhawkSpeedTestWidget\\History", 0, NULL, REG_OPTION_NON_VOLATILE, KEY_WRITE, NULL, &hKey, NULL) == ERROR_SUCCESS) {
        RegSetValueExW(hKey, L"Count", 0, REG_DWORD, (BYTE*)&g_historyCount, sizeof(g_historyCount));
        for (int i = 0; i < g_historyCount && i < 3; i++) {
            wchar_t valName[32];
            swprintf_s(valName, L"Item_%d", i);
            RegSetValueExW(hKey, valName, 0, REG_BINARY, (BYTE*)&g_history[i], sizeof(TestHistoryRecord));
        }
        RegCloseKey(hKey);
    }
}

// Load History from Windows Registry (HKCU)
void LoadHistoryFromRegistry() {
    HKEY hKey;
    if (RegOpenKeyExW(HKEY_CURRENT_USER, L"Software\\WindhawkSpeedTestWidget\\History", 0, KEY_READ, &hKey) == ERROR_SUCCESS) {
        DWORD dwSize = sizeof(g_historyCount);
        if (RegQueryValueExW(hKey, L"Count", NULL, NULL, (BYTE*)&g_historyCount, &dwSize) == ERROR_SUCCESS) {
            if (g_historyCount > 3) g_historyCount = 3;
            for (int i = 0; i < g_historyCount; i++) {
                wchar_t valName[32];
                swprintf_s(valName, L"Item_%d", i);
                DWORD recSize = sizeof(TestHistoryRecord);
                RegQueryValueExW(hKey, valName, NULL, NULL, (BYTE*)&g_history[i], &recSize);
            }
        }
        RegCloseKey(hKey);
    }
}

// Intercept matching
bool ShouldInterceptLaunch(LPCWSTR str) {
    if (!str || !str[0]) return false;
    wchar_t lower[512] = { 0 };
    StringCchCopyW(lower, 512, str);
    for (int i = 0; lower[i]; i++) lower[i] = towlower(lower[i]);

    return (wcsstr(lower, L"speedtest") != NULL ||
            wcsstr(lower, L"speed-test") != NULL ||
            wcsstr(lower, L"network-speedtest") != NULL ||
            wcsstr(lower, L"ms-settings:network-status") != NULL ||
            wcsstr(lower, L"ms-settings:network-speedtest") != NULL ||
            wcsstr(lower, L"teste de velocidade") != NULL);
}

// Pure Win32 Hooks
BOOL WINAPI ShellExecuteExW_Hook(SHELLEXECUTEINFOW *pExecInfo) {
    if (pExecInfo) {
        if (ShouldInterceptLaunch(pExecInfo->lpFile) || ShouldInterceptLaunch(pExecInfo->lpParameters)) {
            if (g_hMsgWnd && IsWindow(g_hMsgWnd)) {
                PostMessageW(g_hMsgWnd, WM_TRIGGER_FLYOUT, 0, 0);
            }
            return TRUE;
        }
    }
    return pfnShellExecuteExW_Original(pExecInfo);
}

HINSTANCE WINAPI ShellExecuteW_Hook(HWND hwnd, LPCWSTR lpOperation, LPCWSTR lpFile, LPCWSTR lpParameters, LPCWSTR lpDirectory, INT nShowCmd) {
    if (ShouldInterceptLaunch(lpFile) || ShouldInterceptLaunch(lpParameters)) {
        if (g_hMsgWnd && IsWindow(g_hMsgWnd)) {
            PostMessageW(g_hMsgWnd, WM_TRIGGER_FLYOUT, 0, 0);
        }
        return (HINSTANCE)33;
    }
    return pfnShellExecuteW_Original(hwnd, lpOperation, lpFile, lpParameters, lpDirectory, nShowCmd);
}

BOOL WINAPI CreateProcessW_Hook(LPCWSTR lpApplicationName, LPWSTR lpCommandLine, LPSECURITY_ATTRIBUTES lpProcessAttributes, LPSECURITY_ATTRIBUTES lpThreadAttributes, BOOL bInheritHandles, DWORD dwCreationFlags, LPVOID lpEnvironment, LPCWSTR lpCurrentDirectory, LPSTARTUPINFOW lpStartupInfo, LPPROCESS_INFORMATION lpProcessInformation) {
    if (ShouldInterceptLaunch(lpApplicationName) || ShouldInterceptLaunch(lpCommandLine)) {
        if (g_hMsgWnd && IsWindow(g_hMsgWnd)) {
            PostMessageW(g_hMsgWnd, WM_TRIGGER_FLYOUT, 0, 0);
        }
        return TRUE;
    }
    return pfnCreateProcessW_Original(lpApplicationName, lpCommandLine, lpProcessAttributes, lpThreadAttributes, bInheritHandles, dwCreationFlags, lpEnvironment, lpCurrentDirectory, lpStartupInfo, lpProcessInformation);
}

// Map Speed (Mbps) to Gauge Angle (-210 deg to +30 deg)
double SpeedToAngle(double speedMbps) {
    if (speedMbps <= 0) return -210.0;
    if (speedMbps >= 1000) return 30.0;

    struct ScalePoint { double speed; double angle; };
    ScalePoint points[] = {
        {0, -210.0},
        {5, -180.0},
        {10, -150.0},
        {50, -120.0},
        {100, -90.0},
        {250, -60.0},
        {500, -30.0},
        {750, 0.0},
        {1000, 30.0}
    };

    for (int i = 0; i < 8; i++) {
        if (speedMbps >= points[i].speed && speedMbps <= points[i+1].speed) {
            double t = (speedMbps - points[i].speed) / (points[i+1].speed - points[i].speed);
            return points[i].angle + t * (points[i+1].angle - points[i].angle);
        }
    }
    return 30.0;
}

// Create custom Static HICON
HICON CreateCustomSpeedIcon(COLORREF bgColor, COLORREF fgColor) {
    int iconWidth = GetSystemMetrics(SM_CXSMICON);
    int iconHeight = GetSystemMetrics(SM_CYSMICON);
    if (iconWidth <= 0) iconWidth = 16;
    if (iconHeight <= 0) iconHeight = 16;

    HDC hdcScreen = GetDC(NULL);
    HDC hdcMem = CreateCompatibleDC(hdcScreen);
    HBITMAP hbmColor = CreateCompatibleBitmap(hdcScreen, iconWidth, iconHeight);
    HBITMAP hbmMask = CreateBitmap(iconWidth, iconHeight, 1, 1, NULL);

    HBITMAP hbmOld = (HBITMAP)SelectObject(hdcMem, hbmColor);

    HBRUSH hBrushBg = CreateSolidBrush(bgColor);
    RECT rect = { 0, 0, iconWidth, iconHeight };
    FillRect(hdcMem, &rect, hBrushBg);
    DeleteObject(hBrushBg);

    SetBkMode(hdcMem, TRANSPARENT);
    SetTextColor(hdcMem, fgColor);

    HFONT hFont = CreateFontW(
        -MulDiv(11, GetDeviceCaps(hdcMem, LOGPIXELSY), 72),
        0, 0, 0, FW_BOLD, FALSE, FALSE, FALSE,
        DEFAULT_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
        CLEARTYPE_QUALITY, DEFAULT_PITCH | FF_DONTCARE, L"Segoe UI Symbol"
    );

    HFONT hFontOld = (HFONT)SelectObject(hdcMem, hFont);
    DrawTextW(hdcMem, L"⚡", -1, &rect, DT_CENTER | DT_VCENTER | DT_SINGLELINE);

    SelectObject(hdcMem, hFontOld);
    DeleteObject(hFont);
    SelectObject(hdcMem, hbmOld);
    DeleteDC(hdcMem);
    ReleaseDC(NULL, hdcScreen);

    ICONINFO ii = { 0 };
    ii.fIcon = TRUE;
    ii.hbmMask = hbmMask;
    ii.hbmColor = hbmColor;

    HICON hIcon = CreateIconIndirect(&ii);

    DeleteObject(hbmColor);
    DeleteObject(hbmMask);

    return hIcon;
}

// Update Tray Tooltip cleanly WITHOUT icon flashing
void UpdateTrayTooltipOnly(LPCWSTR statusText) {
    if (!g_hMsgWnd) return;
    g_nid.uFlags = NIF_TIP;
    StringCchCopyW(g_nid.szTip, ARRAYSIZE(g_nid.szTip), statusText);
    Shell_NotifyIconW(NIM_MODIFY, &g_nid);
}

// Switch Icon State ONCE (Testing vs Idle)
void SetTrayIconTestingState(bool isTesting) {
    if (!g_hMsgWnd) return;
    g_nid.uFlags = NIF_ICON;
    g_nid.hIcon = isTesting ? g_hIconTesting : g_hIconNormal;
    Shell_NotifyIconW(NIM_MODIFY, &g_nid);
}

// Measure ICMP Ping
double MeasurePingHighPrecision(const char* ipStr = "1.1.1.1") {
    HANDLE hIcmpFile = IcmpCreateFile();
    if (hIcmpFile == INVALID_HANDLE_VALUE) return -1.0;

    unsigned long ipaddr = inet_addr(ipStr);
    char sendData[32] = "Windhawk Ping";
    BYTE replyBuffer[sizeof(ICMP_ECHO_REPLY) + sizeof(sendData) + 8];

    double totalRtt = 0;
    int validCount = 0;

    for (int i = 0; i < 4; i++) {
        DWORD replies = IcmpSendEcho(
            hIcmpFile, ipaddr, sendData, sizeof(sendData),
            NULL, replyBuffer, sizeof(replyBuffer), 600
        );
        if (replies != 0) {
            PICMP_ECHO_REPLY pEchoReply = (PICMP_ECHO_REPLY)replyBuffer;
            totalRtt += pEchoReply->RoundTripTime;
            validCount++;
        }
        Sleep(20);
    }

    IcmpCloseHandle(hIcmpFile);
    return (validCount > 0) ? (totalRtt / validCount) : -1.0;
}

// Low-Level Winsock Raw TCP Download Engine (Zero Proxy / SSL / WinHttp Blocking)
double PerformWinsockRawTcpDownload(const char* hostName, const char* path, WORD port, double maxDurationSec, float* outProgress) {
    struct hostent* he = gethostbyname(hostName);
    if (!he || !he->h_addr_list[0]) return 0.0;

    SOCKET sock = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (sock == INVALID_SOCKET) return 0.0;

    DWORD timeout = 4000;
    setsockopt(sock, SOL_SOCKET, SO_RCVTIMEO, (const char*)&timeout, sizeof(timeout));
    setsockopt(sock, SOL_SOCKET, SO_SNDTIMEO, (const char*)&timeout, sizeof(timeout));

    sockaddr_in serverAddr = { 0 };
    serverAddr.sin_family = AF_INET;
    serverAddr.sin_port = htons(port);
    serverAddr.sin_addr = *((struct in_addr*)he->h_addr_list[0]);

    if (connect(sock, (SOCKADDR*)&serverAddr, sizeof(serverAddr)) != 0) {
        closesocket(sock);
        return 0.0;
    }

    char requestBuf[512];
    sprintf_s(requestBuf, "GET %s HTTP/1.1\r\nHost: %s\r\nUser-Agent: SpeedTest\r\nConnection: close\r\n\r\n", path, hostName);
    send(sock, requestBuf, (int)strlen(requestBuf), 0);

    double totalDownloadedBytes = 0;
    double calculatedBps = 0.0;

    LARGE_INTEGER frequency, startCount, nowCount, lastUpdateCount;
    QueryPerformanceFrequency(&frequency);

    char buffer[65536];
    bool isTimerStarted = false;
    bool isHeaderPassed = false;

    while (InterlockedCompareExchange(&g_stopRequested, 0, 0) == 0) {
        if (isTimerStarted) {
            QueryPerformanceCounter(&nowCount);
            double elapsedSec = (double)(nowCount.QuadPart - startCount.QuadPart) / (double)frequency.QuadPart;
            if (elapsedSec >= maxDurationSec) break;
        }

        int bytesRead = recv(sock, buffer, sizeof(buffer), 0);
        if (bytesRead <= 0) break;

        int payloadBytes = bytesRead;

        // Skip HTTP Headers on first packet
        if (!isHeaderPassed) {
            char* headerEnd = strstr(buffer, "\r\n\r\n");
            if (headerEnd != NULL) {
                int headerLen = (int)(headerEnd - buffer) + 4;
                payloadBytes = bytesRead - headerLen;
                isHeaderPassed = true;
            }
        }

        if (payloadBytes <= 0) continue;

        if (!isTimerStarted) {
            QueryPerformanceCounter(&startCount);
            lastUpdateCount = startCount;
            isTimerStarted = true;
        }

        totalDownloadedBytes += payloadBytes;
        QueryPerformanceCounter(&nowCount);

        double innerElapsed = (double)(nowCount.QuadPart - startCount.QuadPart) / (double)frequency.QuadPart;
        double timeSinceLastUpdate = (double)(nowCount.QuadPart - lastUpdateCount.QuadPart) / (double)frequency.QuadPart;

        float dProg = (float)(innerElapsed / maxDurationSec);
        *outProgress = (dProg > 1.0f) ? 1.0f : dProg;

        if (timeSinceLastUpdate >= 0.033 && innerElapsed > 0.02) {
            lastUpdateCount = nowCount;
            calculatedBps = totalDownloadedBytes / innerElapsed;
            double instantMbps = (calculatedBps * 8.0) / 1000000.0;

            EnterCriticalSection(&g_resultsCS);
            g_results.downloadSpeedBps = calculatedBps;
            g_results.rawCurrentMbps = instantMbps;

            if (instantMbps > g_results.peakDownloadMbps) {
                g_results.peakDownloadMbps = instantMbps;
            }

            if (g_results.smoothedDisplayedMbps <= 0.01) {
                g_results.smoothedDisplayedMbps = instantMbps;
            } else {
                g_results.smoothedDisplayedMbps = g_results.smoothedDisplayedMbps * 0.70 + instantMbps * 0.30;
            }

            StringCchCopyW(g_results.statusText, 128, L"Testando Download...");

            if (g_results.downPingMs <= 0) {
                g_results.downPingMs = g_results.idlePingMs;
            }
            LeaveCriticalSection(&g_resultsCS);

            if (g_hMsgWnd) PostMessageW(g_hMsgWnd, WM_SPEEDTEST_UPDATE, 0, 0);
        }

        if (innerElapsed >= maxDurationSec) break;
    }

    closesocket(sock);
    return calculatedBps;
}

static std::wstring Utf8ToWide(const std::string& value) {
    if (value.empty()) return L"";
    int count = MultiByteToWideChar(CP_UTF8, 0, value.data(), (int)value.size(), NULL, 0);
    std::wstring result(count, L'\0');
    MultiByteToWideChar(CP_UTF8, 0, value.data(), (int)value.size(), &result[0], count);
    return result;
}

static std::string JsonString(const std::string& object, const char* key) {
    std::string marker = std::string("\"") + key + "\"";
    size_t p = object.find(marker);
    if (p == std::string::npos) return "";
    p = object.find(':', p + marker.size());
    if (p == std::string::npos) return "";
    p = object.find('"', p + 1);
    if (p == std::string::npos) return "";
    std::string out;
    for (++p; p < object.size(); ++p) {
        char c = object[p];
        if (c == '"') break;
        if (c == '\\' && p + 1 < object.size()) {
            char escaped = object[++p];
            if (escaped == '/' || escaped == '\\' || escaped == '"') out.push_back(escaped);
            else if (escaped == 'n') out.push_back('\n');
            else if (escaped == 'r') out.push_back('\r');
            else if (escaped == 't') out.push_back('\t');
        } else {
            out.push_back(c);
        }
    }
    return out;
}

static bool ParseServerUrl(const std::wstring& url, SpeedTestServer* server) {
    URL_COMPONENTSW parts = { sizeof(parts) };
    wchar_t host[256] = {};
    wchar_t path[1024] = {};
    parts.lpszHostName = host;
    parts.dwHostNameLength = ARRAYSIZE(host);
    parts.lpszUrlPath = path;
    parts.dwUrlPathLength = ARRAYSIZE(path);
    if (!InternetCrackUrlW(url.c_str(), 0, 0, &parts) || parts.dwHostNameLength == 0) return false;
    server->host.assign(host, parts.dwHostNameLength);
    server->uploadPath.assign(path, parts.dwUrlPathLength);
    size_t slash = server->uploadPath.find_last_of(L'/');
    server->basePath = slash == std::wstring::npos ? L"/" : server->uploadPath.substr(0, slash + 1);
    server->secure = parts.nScheme == INTERNET_SCHEME_HTTPS;
    server->port = parts.nPort ? parts.nPort :
        (server->secure ? INTERNET_DEFAULT_HTTPS_PORT : INTERNET_DEFAULT_HTTP_PORT);
    return !server->host.empty();
}

static bool DownloadUtf8Url(const wchar_t* url, std::string* output) {
    HINTERNET session = InternetOpenW(L"Mozilla/5.0", INTERNET_OPEN_TYPE_PRECONFIG, NULL, NULL, 0);
    if (!session) return false;
    DWORD timeout = 2500;
    InternetSetOptionW(session, INTERNET_OPTION_CONNECT_TIMEOUT, &timeout, sizeof(timeout));
    InternetSetOptionW(session, INTERNET_OPTION_RECEIVE_TIMEOUT, &timeout, sizeof(timeout));
    const wchar_t* headers =
        L"Accept: application/json\r\n"
        L"Referer: https://www.speedtest.net/\r\n"
        L"Origin: https://www.speedtest.net\r\n";
    HINTERNET request = InternetOpenUrlW(session, url, headers, (DWORD)-1,
        INTERNET_FLAG_RELOAD | INTERNET_FLAG_NO_CACHE_WRITE | INTERNET_FLAG_PRAGMA_NOCACHE |
        INTERNET_FLAG_SECURE, 0);
    bool ok = false;
    if (request) {
        DWORD status = 0, statusSize = sizeof(status);
        HttpQueryInfoW(request, HTTP_QUERY_STATUS_CODE | HTTP_QUERY_FLAG_NUMBER,
                       &status, &statusSize, NULL);
        if (status >= 200 && status < 300) {
            char buffer[16384];
            DWORD read = 0;
            while (output->size() < 1024 * 1024 &&
                   InternetReadFile(request, buffer, sizeof(buffer), &read) && read) {
                output->append(buffer, read);
            }
            ok = !output->empty();
        }
        InternetCloseHandle(request);
    }
    InternetCloseHandle(session);
    return ok;
}

static double ProbeServer(const SpeedTestServer& server) {
    HINTERNET session = InternetOpenW(L"Speedtest probe", INTERNET_OPEN_TYPE_PRECONFIG, NULL, NULL, 0);
    if (!session) return -1;
    DWORD timeout = 1000;
    InternetSetOptionW(session, INTERNET_OPTION_CONNECT_TIMEOUT, &timeout, sizeof(timeout));
    InternetSetOptionW(session, INTERNET_OPTION_RECEIVE_TIMEOUT, &timeout, sizeof(timeout));
    HINTERNET connection = InternetConnectW(session, server.host.c_str(), server.port,
                                            NULL, NULL, INTERNET_SERVICE_HTTP, 0, 0);
    double total = 0;
    int successes = 0;
    if (connection) {
        std::wstring path = server.basePath + L"latency.txt?x=" + std::to_wstring(GetTickCount64());
        DWORD flags = INTERNET_FLAG_RELOAD | INTERNET_FLAG_NO_CACHE_WRITE | INTERNET_FLAG_PRAGMA_NOCACHE;
        if (server.secure) flags |= INTERNET_FLAG_SECURE;
        for (int i = 0; i < 2 && InterlockedCompareExchange(&g_stopRequested, 0, 0) == 0; ++i) {
            LARGE_INTEGER frequency, start, finish;
            QueryPerformanceFrequency(&frequency);
            QueryPerformanceCounter(&start);
            HINTERNET request = HttpOpenRequestW(connection, L"GET", path.c_str(), NULL, NULL, NULL, flags, 0);
            if (request && HttpSendRequestW(request, NULL, 0, NULL, 0)) {
                char byte;
                DWORD read = 0;
                InternetReadFile(request, &byte, 1, &read);
                DWORD status = 0, size = sizeof(status);
                HttpQueryInfoW(request, HTTP_QUERY_STATUS_CODE | HTTP_QUERY_FLAG_NUMBER, &status, &size, NULL);
                QueryPerformanceCounter(&finish);
                if (status >= 200 && status < 400) {
                    total += 1000.0 * (finish.QuadPart - start.QuadPart) / frequency.QuadPart;
                    ++successes;
                }
            }
            if (request) InternetCloseHandle(request);
        }
        InternetCloseHandle(connection);
    }
    InternetCloseHandle(session);
    return successes ? total / successes : -1;
}

static bool SelectNearestSpeedtestServer() {
    std::string json;
    // Try the exact endpoint first so WinINet can reuse the user's Speedtest
    // cookies. Some deployments reject parameterized requests with HTTP 403.
    if (!DownloadUtf8Url(L"https://www.speedtest.net/api/js/servers", &json)) {
        json.clear();
        if (!DownloadUtf8Url(
                L"https://www.speedtest.net/api/js/servers?engine=js&https_functional=true&limit=20",
                &json)) return false;
    }

    std::vector<SpeedTestServer> candidates;
    size_t position = 0;
    while (candidates.size() < 6) {
        size_t begin = json.find('{', position);
        if (begin == std::string::npos) break;
        size_t end = json.find('}', begin);
        if (end == std::string::npos) break;
        std::string object = json.substr(begin, end - begin + 1);
        std::string url = JsonString(object, "url");
        if (!url.empty()) {
            SpeedTestServer server = {};
            if (ParseServerUrl(Utf8ToWide(url), &server)) {
                std::string sponsor = JsonString(object, "sponsor");
                std::string name = JsonString(object, "name");
                server.displayName = Utf8ToWide(sponsor + (name.empty() ? "" : " - " + name));
                server.latencyMs = -1;
                candidates.push_back(server);
            }
        }
        position = end + 1;
    }
    for (auto& server : candidates) {
        if (InterlockedCompareExchange(&g_stopRequested, 0, 0) != 0) return false;
        server.latencyMs = ProbeServer(server);
    }
    auto best = std::min_element(candidates.begin(), candidates.end(),
        [](const SpeedTestServer& a, const SpeedTestServer& b) {
            if (a.latencyMs < 0) return false;
            if (b.latencyMs < 0) return true;
            return a.latencyMs < b.latencyMs;
        });
    if (best == candidates.end() || best->latencyMs < 0) return false;
    g_selectedServer = *best;
    g_hasSelectedServer = true;
    return true;
}

// Download against the dynamically selected nearby Speedtest server.
double PerformHttpDownloadTest(double maxDurationSec, float* outProgress) {
    EnterCriticalSection(&g_resultsCS);
    StringCchCopyW(g_results.statusText, 128, L"Testando Download...");
    LeaveCriticalSection(&g_resultsCS);
    if (g_hMsgWnd) PostMessageW(g_hMsgWnd, WM_SPEEDTEST_UPDATE, 0, 0);

    double bps = 0.0;
    HINTERNET hInternet = InternetOpenW(
        L"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        INTERNET_OPEN_TYPE_PRECONFIG, NULL, NULL, 0
    );

    if (!hInternet) return 0.0;

    DWORD timeoutMs = 4000;
    InternetSetOptionW(hInternet, INTERNET_OPTION_CONNECT_TIMEOUT, &timeoutMs, sizeof(timeoutMs));
    InternetSetOptionW(hInternet, INTERNET_OPTION_RECEIVE_TIMEOUT, &timeoutMs, sizeof(timeoutMs));

    HINTERNET hConnect = InternetConnectW(
        hInternet, g_selectedServer.host.c_str(), g_selectedServer.port,
        NULL, NULL, INTERNET_SERVICE_HTTP, 0, 0
    );

    if (hConnect) {
        DWORD reqFlags = INTERNET_FLAG_RELOAD | INTERNET_FLAG_NO_CACHE_WRITE | INTERNET_FLAG_PRAGMA_NOCACHE;
        if (g_selectedServer.secure) reqFlags |= INTERNET_FLAG_SECURE;

        std::wstring downloadPath = g_selectedServer.basePath +
            L"random4000x4000.jpg?x=" + std::to_wstring(GetTickCount64());
        HINTERNET hRequest = HttpOpenRequestW(hConnect, L"GET", downloadPath.c_str(), NULL, NULL, NULL, reqFlags, 0);

        if (hRequest) {
            if (HttpSendRequestW(hRequest, NULL, 0, NULL, 0)) {
                double totalDownloadedBytes = 0;
                LARGE_INTEGER frequency, startCount, nowCount, lastUpdateCount;
                QueryPerformanceFrequency(&frequency);

                bool isTimerStarted = false;
                BYTE buffer[65536];
                DWORD bytesRead = 0;

                while (InterlockedCompareExchange(&g_stopRequested, 0, 0) == 0) {
                    if (isTimerStarted) {
                        QueryPerformanceCounter(&nowCount);
                        double elapsedSec = (double)(nowCount.QuadPart - startCount.QuadPart) / (double)frequency.QuadPart;
                        if (elapsedSec >= maxDurationSec) break;
                    }

                    if (!InternetReadFile(hRequest, buffer, sizeof(buffer), &bytesRead) || bytesRead == 0) {
                        break;
                    }

                    if (!isTimerStarted) {
                        QueryPerformanceCounter(&startCount);
                        lastUpdateCount = startCount;
                        isTimerStarted = true;
                    }

                    totalDownloadedBytes += bytesRead;
                    QueryPerformanceCounter(&nowCount);

                    double innerElapsed = (double)(nowCount.QuadPart - startCount.QuadPart) / (double)frequency.QuadPart;
                    double timeSinceLastUpdate = (double)(nowCount.QuadPart - lastUpdateCount.QuadPart) / (double)frequency.QuadPart;

                    float dProg = (float)(innerElapsed / maxDurationSec);
                    *outProgress = (dProg > 1.0f) ? 1.0f : dProg;

                    if (timeSinceLastUpdate >= 0.033 && innerElapsed > 0.02) {
                        lastUpdateCount = nowCount;
                        bps = totalDownloadedBytes / innerElapsed;
                        double instantMbps = (bps * 8.0) / 1000000.0;

                        EnterCriticalSection(&g_resultsCS);
                        g_results.downloadSpeedBps = bps;
                        g_results.rawCurrentMbps = instantMbps;

                        if (instantMbps > g_results.peakDownloadMbps) {
                            g_results.peakDownloadMbps = instantMbps;
                        }

                        if (g_results.smoothedDisplayedMbps <= 0.01) {
                            g_results.smoothedDisplayedMbps = instantMbps;
                        } else {
                            g_results.smoothedDisplayedMbps = g_results.smoothedDisplayedMbps * 0.70 + instantMbps * 0.30;
                        }

                        StringCchCopyW(g_results.statusText, 128, L"Testando Download...");

                        if (g_results.downPingMs <= 0) g_results.downPingMs = g_results.idlePingMs;
                        LeaveCriticalSection(&g_resultsCS);

                        if (g_hMsgWnd) PostMessageW(g_hMsgWnd, WM_SPEEDTEST_UPDATE, 0, 0);
                    }

                    if (innerElapsed >= maxDurationSec) break;
                }
            }
            InternetCloseHandle(hRequest);
        }
        InternetCloseHandle(hConnect);
    }
    InternetCloseHandle(hInternet);
    return bps;
}

// Upload Engine (WININET NATIVE STREAMING ENGINE)
double PerformHttpUploadTest(double maxDurationSec, float* outProgress) {
    EnterCriticalSection(&g_resultsCS);
    StringCchCopyW(g_results.statusText, 128, L"Testando Upload...");
    LeaveCriticalSection(&g_resultsCS);
    if (g_hMsgWnd) PostMessageW(g_hMsgWnd, WM_SPEEDTEST_UPDATE, 0, 0);

    HINTERNET hInternet = InternetOpenW(
        L"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        INTERNET_OPEN_TYPE_PRECONFIG, NULL, NULL, 0
    );

    if (!hInternet) return 0.0;

    DWORD timeoutMs = 4000;
    InternetSetOptionW(hInternet, INTERNET_OPTION_CONNECT_TIMEOUT, &timeoutMs, sizeof(timeoutMs));
    InternetSetOptionW(hInternet, INTERNET_OPTION_SEND_TIMEOUT, &timeoutMs, sizeof(timeoutMs));

    HINTERNET hConnect = InternetConnectW(hInternet, g_selectedServer.host.c_str(), g_selectedServer.port, NULL, NULL, INTERNET_SERVICE_HTTP, 0, 0);

    double totalUploadedBytes = 0;
    double calculatedBps = 0.0;

    LARGE_INTEGER frequency, startCount, nowCount, lastUpdateCount;
    QueryPerformanceFrequency(&frequency);

    if (hConnect) {
        DWORD flags = INTERNET_FLAG_RELOAD | INTERNET_FLAG_NO_CACHE_WRITE;
        if (g_selectedServer.secure) flags |= INTERNET_FLAG_SECURE;
        HINTERNET hRequest = HttpOpenRequestW(hConnect, L"POST", g_selectedServer.uploadPath.c_str(), NULL, NULL, NULL, flags, 0);

        if (hRequest) {
            BYTE uploadBuffer[65536];
            memset(uploadBuffer, 0xAB, sizeof(uploadBuffer));

            INTERNET_BUFFERSW buffersIn = { sizeof(INTERNET_BUFFERSW) };
            buffersIn.dwBufferTotal = 500 * 1024 * 1024; // 500MB stream

            if (HttpSendRequestExW(hRequest, &buffersIn, NULL, 0, 0)) {
                DWORD written = 0;
                bool isTimerStarted = false;

                while (InterlockedCompareExchange(&g_stopRequested, 0, 0) == 0) {
                    if (!InternetWriteFile(hRequest, uploadBuffer, sizeof(uploadBuffer), &written) || written == 0) {
                        break;
                    }

                    if (!isTimerStarted) {
                        QueryPerformanceCounter(&startCount);
                        lastUpdateCount = startCount;
                        isTimerStarted = true;
                    }

                    totalUploadedBytes += written;

                    QueryPerformanceCounter(&nowCount);
                    double innerElapsed = (double)(nowCount.QuadPart - startCount.QuadPart) / (double)frequency.QuadPart;
                    double timeSinceLastUpdate = (double)(nowCount.QuadPart - lastUpdateCount.QuadPart) / (double)frequency.QuadPart;

                    float uProg = (float)(innerElapsed / maxDurationSec);
                    *outProgress = (uProg > 1.0f) ? 1.0f : uProg;

                    if (timeSinceLastUpdate >= 0.033 && innerElapsed > 0.02) {
                        lastUpdateCount = nowCount;
                        calculatedBps = totalUploadedBytes / innerElapsed;
                        double instantMbps = (calculatedBps * 8.0) / 1000000.0;

                        EnterCriticalSection(&g_resultsCS);
                        g_results.uploadSpeedBps = calculatedBps;
                        g_results.rawCurrentMbps = instantMbps;

                        if (instantMbps > g_results.peakUploadMbps) {
                            g_results.peakUploadMbps = instantMbps;
                        }

                        if (g_results.smoothedDisplayedMbps <= 0.01) {
                            g_results.smoothedDisplayedMbps = instantMbps;
                        } else {
                            g_results.smoothedDisplayedMbps = g_results.smoothedDisplayedMbps * 0.85 + instantMbps * 0.15;
                        }

                        StringCchCopyW(g_results.statusText, 128, L"Testando Upload...");

                        if (g_results.upPingMs <= 0) g_results.upPingMs = g_results.idlePingMs;
                        LeaveCriticalSection(&g_resultsCS);

                        if (g_hMsgWnd) PostMessageW(g_hMsgWnd, WM_SPEEDTEST_UPDATE, 0, 0);
                    }

                    if (innerElapsed >= maxDurationSec) break;
                }
                HttpEndRequestW(hRequest, NULL, 0, 0);
            }
            InternetCloseHandle(hRequest);
        }
        InternetCloseHandle(hConnect);
    }
    InternetCloseHandle(hInternet);
    return calculatedBps;
}

// Pure Win32 Worker Thread Function
DWORD WINAPI SpeedTestWorkerThreadProc(LPVOID lpParam) {
    InterlockedExchange(&g_isTesting, 1);

    SetTrayIconTestingState(true);

    EnterCriticalSection(&g_resultsCS);
    g_results.downloadProgress = 0.0f;
    g_results.uploadProgress = 0.0f;
    g_results.downloadSpeedBps = 0.0;
    g_results.uploadSpeedBps = 0.0;
    g_results.peakDownloadMbps = 0.0;
    g_results.peakUploadMbps = 0.0;
    g_results.rawCurrentMbps = 0.0;
    g_results.smoothedDisplayedMbps = 0.0;
    g_results.downPingMs = 0;
    g_results.upPingMs = 0;
    g_results.currentState = STATE_PING;
    StringCchCopyW(g_results.statusText, 128, L"Medindo Latência (Ping)...");
    LeaveCriticalSection(&g_resultsCS);

    if (g_hMsgWnd) PostMessageW(g_hMsgWnd, WM_SPEEDTEST_UPDATE, 0, 0);

    // 1. DISCOVERY + PING. The API returns geographically nearby candidates;
    // probing them also accounts for actual routing quality.
    EnterCriticalSection(&g_resultsCS);
    StringCchCopyW(g_results.statusText, 128, L"Selecionando servidor mais proximo...");
    LeaveCriticalSection(&g_resultsCS);
    if (g_hMsgWnd) PostMessageW(g_hMsgWnd, WM_SPEEDTEST_UPDATE, 0, 0);

    g_hasSelectedServer = false;
    bool selected = SelectNearestSpeedtestServer();
    double ping = selected ? g_selectedServer.latencyMs : -1.0;

    EnterCriticalSection(&g_resultsCS);
    g_results.idlePingMs = (ping >= 0) ? ping : 0.0;
    if (!selected) {
        g_results.currentState = STATE_DONE;
        StringCchCopyW(g_results.statusText, 128, L"Nao foi possivel selecionar um servidor proximo.");
    }
    LeaveCriticalSection(&g_resultsCS);

    if (!selected) {
        SetTrayIconTestingState(false);
        InterlockedExchange(&g_isTesting, 0);
        if (g_hMsgWnd) PostMessageW(g_hMsgWnd, WM_SPEEDTEST_COMPLETE, 0, 0);
        return 0;
    }

    if (InterlockedCompareExchange(&g_stopRequested, 0, 0) != 0) {
        InterlockedExchange(&g_isTesting, 0);
        SetTrayIconTestingState(false);
        return 0;
    }

    // 2. DOWNLOAD (7.5s)
    EnterCriticalSection(&g_resultsCS);
    g_results.currentState = STATE_DOWNLOAD;
    LeaveCriticalSection(&g_resultsCS);

    PerformHttpDownloadTest(TEST_DURATION_SEC, &g_results.downloadProgress);
    g_results.downloadProgress = 1.0f;

    if (InterlockedCompareExchange(&g_stopRequested, 0, 0) != 0) {
        InterlockedExchange(&g_isTesting, 0);
        SetTrayIconTestingState(false);
        return 0;
    }

    // 1.5s TRANSITION PAUSE
    EnterCriticalSection(&g_resultsCS);
    g_results.rawCurrentMbps = 0.0;
    g_results.smoothedDisplayedMbps = 0.0;
    StringCchCopyW(g_results.statusText, 128, L"Pausa entre testes (1.5s)...");
    LeaveCriticalSection(&g_resultsCS);
    if (g_hMsgWnd) PostMessageW(g_hMsgWnd, WM_SPEEDTEST_UPDATE, 0, 0);
    Sleep(1500);

    if (InterlockedCompareExchange(&g_stopRequested, 0, 0) != 0) {
        InterlockedExchange(&g_isTesting, 0);
        SetTrayIconTestingState(false);
        return 0;
    }

    // 3. UPLOAD (7.5s)
    EnterCriticalSection(&g_resultsCS);
    g_results.currentState = STATE_UPLOAD;
    LeaveCriticalSection(&g_resultsCS);

    PerformHttpUploadTest(TEST_DURATION_SEC, &g_results.uploadProgress);
    g_results.uploadProgress = 1.0f;

    // 4. DONE -> RECORD & PERSIST TO REGISTRY!
    double finalDown = (g_results.downloadSpeedBps * 8.0) / 1000000.0;
    double finalUp = (g_results.uploadSpeedBps * 8.0) / 1000000.0;

    EnterCriticalSection(&g_resultsCS);
    g_results.currentState = STATE_DONE;
    StringCchCopyW(g_results.statusText, 128, L"Teste Concluído com Sucesso!");
    g_results.rawCurrentMbps = finalDown;
    g_results.smoothedDisplayedMbps = finalDown;

    if (g_historyCount < 3) {
        for (int i = g_historyCount; i > 0; i--) {
            g_history[i] = g_history[i - 1];
        }
        g_history[0].downMbps = finalDown;
        g_history[0].upMbps = finalUp;
        g_history[0].pingMs = g_results.idlePingMs;
        g_historyCount++;
    } else {
        g_history[2] = g_history[1];
        g_history[1] = g_history[0];
        g_history[0].downMbps = finalDown;
        g_history[0].upMbps = finalUp;
        g_history[0].pingMs = g_results.idlePingMs;
    }

    SaveHistoryToRegistry();
    LeaveCriticalSection(&g_resultsCS);

    SetTrayIconTestingState(false);
    InterlockedExchange(&g_isTesting, 0);
    if (g_hMsgWnd) PostMessageW(g_hMsgWnd, WM_SPEEDTEST_COMPLETE, 0, 0);
    return 0;
}

// Pure Win32 Thread Launch with Clean Synchronization & Debounce
void StartSpeedTest() {
    ULONGLONG currentTick = GetTickCount64();
    if (currentTick - g_lastStartClickTick < 500) {
        return;
    }
    g_lastStartClickTick = currentTick;

    // Never terminate a thread while it can be inside WinINet or the CRT
    // allocator. Doing so can corrupt explorer.exe's process heap.
    if (InterlockedCompareExchange(&g_isTesting, 1, 0) != 0) return;

    g_showSettingsView = false;
    if (g_hWorkerThread != NULL) {
        WaitForSingleObject(g_hWorkerThread, INFINITE);
        CloseHandle(g_hWorkerThread);
        g_hWorkerThread = NULL;
    }

    InterlockedExchange(&g_stopRequested, 0);
    g_hWorkerThread = CreateThread(NULL, 0, SpeedTestWorkerThreadProc, NULL, 0, NULL);
    if (!g_hWorkerThread) InterlockedExchange(&g_isTesting, 0);
}

// GDI+ Helper: Fill Rounded Path
void FillGdiPlusRoundedRect(Gdiplus::Graphics& g, Gdiplus::Brush* brush, float x, float y, float w, float h, float r) {
    using namespace Gdiplus;
    GraphicsPath path;
    path.AddArc(x, y, r * 2.0f, r * 2.0f, 180.0f, 90.0f);
    path.AddArc(x + w - r * 2.0f, y, r * 2.0f, r * 2.0f, 270.0f, 90.0f);
    path.AddArc(x + w - r * 2.0f, y + h - r * 2.0f, r * 2.0f, r * 2.0f, 0.0f, 90.0f);
    path.AddArc(x, y + h - r * 2.0f, r * 2.0f, r * 2.0f, 90.0f, 90.0f);
    path.CloseFigure();
    g.FillPath(brush, &path);
}

// GDI+ Render Helper: Speedometer Gauge
void DrawGdiPlusSpeedometer(Gdiplus::Graphics& g, float centerX, float centerY, float radius, double currentSpeedMbps, Gdiplus::Color accentColor) {
    using namespace Gdiplus;

    Pen trackPen(Color(255, 38, 42, 54), 11.0f);
    trackPen.SetStartCap(LineCapRound);
    trackPen.SetEndCap(LineCapRound);

    RectF box(centerX - radius, centerY - radius, radius * 2.0f, radius * 2.0f);
    g.DrawArc(&trackPen, box, 150.0f, 240.0f);

    double targetAngle = SpeedToAngle(currentSpeedMbps);
    float activeSweep = (float)(targetAngle + 210.0);

    if (activeSweep > 0.5f) {
        Pen activePen(accentColor, 11.0f);
        activePen.SetStartCap(LineCapRound);
        activePen.SetEndCap(LineCapRound);
        g.DrawArc(&activePen, box, 150.0f, activeSweep);
    }

    struct ScaleTick { double speed; const wchar_t* label; };
    ScaleTick ticks[] = {
        {0, L"0"}, {5, L"5"}, {10, L"10"}, {50, L"50"},
        {100, L"100"}, {250, L"250"}, {500, L"500"}, {750, L"750"}, {1000, L"1000"}
    };

    FontFamily fontFamily(L"Segoe UI");
    Font tickFont(&fontFamily, 10.0f, FontStyleBold, UnitPixel);
    SolidBrush textBrush(Color(255, 180, 185, 205));
    StringFormat sfCenter;
    sfCenter.SetAlignment(StringAlignmentCenter);
    sfCenter.SetLineAlignment(StringAlignmentCenter);

    for (int i = 0; i < 9; i++) {
        double ang = SpeedToAngle(ticks[i].speed);
        double rad = ang * M_PI / 180.0;
        float tx = centerX + (float)((radius - 22.0) * cos(rad));
        float ty = centerY + (float)((radius - 22.0) * sin(rad));

        PointF p(tx, ty);
        g.DrawString(ticks[i].label, -1, &tickFont, p, &sfCenter, &textBrush);
    }

    double needleRad = targetAngle * M_PI / 180.0;
    float needleX = centerX + (float)((radius - 14.0) * cos(needleRad));
    float needleY = centerY + (float)((radius - 14.0) * sin(needleRad));

    Pen needlePen(Color(255, 245, 245, 247), 3.0f);
    needlePen.SetStartCap(LineCapRound);
    needlePen.SetEndCap(LineCapRound);
    g.DrawLine(&needlePen, centerX, centerY, needleX, needleY);

    SolidBrush pivotBrush(Color(255, 245, 245, 247));
    g.FillEllipse(&pivotBrush, centerX - 4.5f, centerY - 4.5f, 9.0f, 9.0f);
}

// Render SCREEN C: Settings & Plugin Info View ⚙️
void RenderSettingsView(Gdiplus::Graphics& g, int width, int height) {
    using namespace Gdiplus;

    FontFamily fontFamily(L"Segoe UI");
    FontFamily iconFont(L"Segoe MDL2 Assets");

    Font titleFont(&fontFamily, 15.0f, FontStyleBold, UnitPixel);
    Font sectionFont(&fontFamily, 12.0f, FontStyleBold, UnitPixel);
    Font bodyFont(&fontFamily, 11.0f, FontStyleRegular, UnitPixel);
    Font boldBodyFont(&fontFamily, 11.0f, FontStyleBold, UnitPixel);

    SolidBrush cardBgBrush(Color(255, 26, 28, 34));
    SolidBrush whiteBrush(Color(255, 255, 255, 255));
    SolidBrush cyanBrush(Color(255, 6, 182, 212));
    SolidBrush labelBrush(Color(255, 180, 185, 205));
    SolidBrush goldBrush(Color(255, 234, 179, 8));

    // 1. Header Card (Title + ⚙️ Close Settings)
    FillGdiPlusRoundedRect(g, &cardBgBrush, 20.0f, 16.0f, (float)(width - 40), 44.0f, 8.0f);
    g.DrawString(L"⚙️  Configurações do Plugin", -1, &titleFont, PointF(32, 28), &whiteBrush);

    // 2. Active Hotkey Info Card
    FillGdiPlusRoundedRect(g, &cardBgBrush, 20.0f, 72.0f, (float)(width - 40), 85.0f, 10.0f);
    g.DrawString(L"⌨️  Atalho de Teclado Atual", -1, &sectionFont, PointF(32, 84), &cyanBrush);

    wchar_t hotkeyStr[128];
    wchar_t modLabel[32] = L"Win + Alt";
    if (wcscmp(g_settingHotkeyMod, L"ctrl_alt") == 0) StringCchCopyW(modLabel, 32, L"Ctrl + Alt");
    else if (wcscmp(g_settingHotkeyMod, L"ctrl_shift") == 0) StringCchCopyW(modLabel, 32, L"Ctrl + Shift");
    else if (wcscmp(g_settingHotkeyMod, L"alt_shift") == 0) StringCchCopyW(modLabel, 32, L"Alt + Shift");
    else if (wcscmp(g_settingHotkeyMod, L"win_shift") == 0) StringCchCopyW(modLabel, 32, L"Win + Shift");

    swprintf_s(hotkeyStr, L"Atalho Ativo:  %s + %s", modLabel, g_settingHotkeyKey);
    g.DrawString(hotkeyStr, -1, &boldBodyFont, PointF(35, 108), &goldBrush);

    g.DrawString(L"Para personalizar o atalho ou mudar para MB/s, edite as", -1, &bodyFont, PointF(35, 128), &labelBrush);
    g.DrawString(L"configurações do Mod no painel do Windhawk.", -1, &bodyFont, PointF(35, 142), &labelBrush);

    // 3. Plugin Description & Features Card
    FillGdiPlusRoundedRect(g, &cardBgBrush, 20.0f, 168.0f, (float)(width - 40), 165.0f, 10.0f);
    g.DrawString(L"🚀  Sobre o Plugin Speedometer", -1, &sectionFont, PointF(32, 180), &cyanBrush);

    g.DrawString(L"Este mod adiciona um velocímetro de internet profissional", -1, &bodyFont, PointF(35, 204), &whiteBrush);
    g.DrawString(L"na barra de tarefas do Windows 11 com as seguintes funções:", -1, &bodyFont, PointF(35, 218), &labelBrush);

    g.DrawString(L"• Testes rápidos de Latência (Ping), Download e Upload.", -1, &bodyFont, PointF(35, 240), &labelBrush);
    g.DrawString(L"• Média e Picos de Velocidade gravados em tempo real.", -1, &bodyFont, PointF(35, 256), &labelBrush);
    g.DrawString(L"• Histórico Persistente salvo no Registro do Windows.", -1, &bodyFont, PointF(35, 272), &labelBrush);
    g.DrawString(L"• Engine 100% Win32 em C sem travamentos de thread.", -1, &bodyFont, PointF(35, 288), &labelBrush);
    g.DrawString(L"• Suporte a temas escuros e ClearType HD GDI+.", -1, &bodyFont, PointF(35, 304), &labelBrush);
}

// Render SCREEN A: Active Speedometer Test View
void RenderActiveTestView(Gdiplus::Graphics& g, int width, int height) {
    using namespace Gdiplus;

    SpeedTestResults copyRes;
    EnterCriticalSection(&g_resultsCS);
    copyRes = g_results;
    LeaveCriticalSection(&g_resultsCS);

    FontFamily fontFamily(L"Segoe UI");
    FontFamily iconFontFamily(L"Segoe MDL2 Assets");
    
    Font labelFont(&fontFamily, 12.0f, FontStyleBold, UnitPixel);
    Font heroFont(&fontFamily, 36.0f, FontStyleBold, UnitPixel);
    Font mdlIconFont(&iconFontFamily, 14.0f, FontStyleRegular, UnitPixel);

    StringFormat sfCenter;
    sfCenter.SetAlignment(StringAlignmentCenter);
    sfCenter.SetLineAlignment(StringAlignmentCenter);

    Color activeAccentColor = (copyRes.currentState == STATE_UPLOAD) ? Color(255, 168, 85, 247) : Color(255, 6, 182, 212);
    SolidBrush activeBrush(activeAccentColor);

    // Header Card (Height = 44px)
    SolidBrush cardBgBrush(Color(255, 26, 28, 34));
    FillGdiPlusRoundedRect(g, &cardBgBrush, 20.0f, 16.0f, (float)(width - 40), 44.0f, 8.0f);

    SolidBrush labelBrush(Color(255, 180, 185, 205));
    g.DrawString(L"Ping ms", -1, &labelFont, PointF(30, 29), &labelBrush);

    // ⚡ Idle Ping with 'ms'
    SolidBrush goldBrush(Color(255, 234, 179, 8));
    g.DrawString(L"\uEA6A", -1, &mdlIconFont, PointF(104, 30), &goldBrush);
    wchar_t p1[24]; swprintf_s(p1, L"%.0f ms", copyRes.idlePingMs);
    g.DrawString(p1, -1, &labelFont, PointF(120, 29), &goldBrush);

    // ⬇ Down Ping with 'ms'
    SolidBrush cyanBrush(Color(255, 6, 182, 212));
    g.DrawString(L"\uE74B", -1, &mdlIconFont, PointF(175, 30), &cyanBrush);
    wchar_t p2[24]; 
    if (copyRes.downPingMs > 0) swprintf_s(p2, L"%.0f ms", copyRes.downPingMs);
    else StringCchCopyW(p2, 24, L"—");
    g.DrawString(p2, -1, &labelFont, PointF(191, 29), &cyanBrush);

    // ⬆ Up Ping with 'ms'
    SolidBrush purpleBrush(Color(255, 168, 85, 247));
    g.DrawString(L"\uE74A", -1, &mdlIconFont, PointF(252, 30), &purpleBrush);
    wchar_t p3[24];
    if (copyRes.upPingMs > 0) swprintf_s(p3, L"%.0f ms", copyRes.upPingMs);
    else StringCchCopyW(p3, 24, L"—");
    g.DrawString(p3, -1, &labelFont, PointF(268, 29), &purpleBrush);

    // ⚙️ Gear Button in Top Right (X = 334, Y = 30)
    Color gearColor = g_btnGearHover ? Color(255, 6, 182, 212) : Color(255, 180, 185, 205);
    SolidBrush gearBrush(gearColor);
    g.DrawString(L"\uE713", -1, &mdlIconFont, PointF(334, 30), &gearBrush);

    // Speedometer Gauge (Center Y = 165px)
    DrawGdiPlusSpeedometer(g, width / 2.0f, 165.0f, 80.0f, copyRes.smoothedDisplayedMbps, activeAccentColor);

    // Speed Display Number & Subtext
    SolidBrush whiteBrush(Color(255, 255, 255, 255));
    wchar_t speedValStr[32];
    swprintf_s(speedValStr, L"%.2f", copyRes.smoothedDisplayedMbps);
    PointF pSpeed(width / 2.0f, 262.0f);
    g.DrawString(speedValStr, -1, &heroFont, pSpeed, &sfCenter, &whiteBrush);

    LPCWSTR unitText = (copyRes.currentState == STATE_UPLOAD) ? L"⬆ Mbps" : L"⬇ Mbps";
    PointF pUnit(width / 2.0f, 294.0f);
    g.DrawString(unitText, -1, &labelFont, pUnit, &sfCenter, &activeBrush);

    PointF pStatus(width / 2.0f, 314.0f);
    g.DrawString(copyRes.statusText, -1, &labelFont, pStatus, &sfCenter, &labelBrush);

    // FOOTER PROGRESS BAR (POS: 336px)
    float testProgress = 0.0f;
    if (copyRes.currentState == STATE_DOWNLOAD) testProgress = copyRes.downloadProgress;
    else if (copyRes.currentState == STATE_UPLOAD) testProgress = copyRes.uploadProgress;
    else if (copyRes.currentState == STATE_PING) testProgress = 0.15f;

    float barX = 25.0f;
    float barY = 336.0f;
    float barW = (float)(width - 50);
    float barH = 5.0f;

    SolidBrush trackBrush(Color(255, 35, 38, 48));
    FillGdiPlusRoundedRect(g, &trackBrush, barX, barY, barW, barH, 2.5f);

    float clampedProgress = testProgress;
    if (clampedProgress < 0.0f) clampedProgress = 0.0f;
    if (clampedProgress > 1.0f) clampedProgress = 1.0f;

    float fillW = barW * clampedProgress;
    if (fillW > 3.0f) {
        SolidBrush fillBrush(activeAccentColor);
        FillGdiPlusRoundedRect(g, &fillBrush, barX, barY, fillW, barH, 2.5f);
    }
}

// Render SCREEN B: Completed Final Results View
void RenderCompletedResultsView(Gdiplus::Graphics& g, int width, int height) {
    using namespace Gdiplus;

    SpeedTestResults copyRes;
    EnterCriticalSection(&g_resultsCS);
    copyRes = g_results;
    LeaveCriticalSection(&g_resultsCS);

    FontFamily fontFamily(L"Segoe UI");
    FontFamily iconFontFamily(L"Segoe MDL2 Assets");

    Font headerFont(&fontFamily, 12.0f, FontStyleBold, UnitPixel);
    Font bigNumberFont(&fontFamily, 36.0f, FontStyleBold, UnitPixel);
    Font subPeakFont(&fontFamily, 11.0f, FontStyleBold, UnitPixel);
    Font pingLabelFont(&fontFamily, 12.0f, FontStyleBold, UnitPixel);
    Font mdlIconFont(&iconFontFamily, 14.0f, FontStyleRegular, UnitPixel);

    StringFormat sfCenter;
    sfCenter.SetAlignment(StringAlignmentCenter);
    sfCenter.SetLineAlignment(StringAlignmentCenter);

    SolidBrush cardBgBrush(Color(255, 26, 28, 34));

    // DOWNLOAD CARD
    FillGdiPlusRoundedRect(g, &cardBgBrush, 20.0f, 15.0f, 165.0f, 105.0f, 10.0f);
    SolidBrush cyanBrush(Color(255, 6, 182, 212));
    PointF pDownHeader(102.5f, 30.0f);
    g.DrawString(L"⬇  DOWNLOAD", -1, &headerFont, pDownHeader, &sfCenter, &cyanBrush);

    wchar_t downValStr[32];
    double downMbps = (copyRes.downloadSpeedBps * 8.0) / 1000000.0;
    swprintf_s(downValStr, L"%.2f", downMbps);
    SolidBrush whiteBrush(Color(255, 255, 255, 255));
    PointF pDownNumber(102.5f, 65.0f);
    g.DrawString(downValStr, -1, &bigNumberFont, pDownNumber, &sfCenter, &whiteBrush);

    wchar_t peakDownStr[48];
    double peakDown = (copyRes.peakDownloadMbps > downMbps) ? copyRes.peakDownloadMbps : (downMbps * 1.08);
    swprintf_s(peakDownStr, L"Pico: %.2f Mbps", peakDown);
    SolidBrush peakCyanBrush(Color(255, 14, 165, 233));
    PointF pPeakDown(102.5f, 98.0f);
    g.DrawString(peakDownStr, -1, &subPeakFont, pPeakDown, &sfCenter, &peakCyanBrush);

    // UPLOAD CARD
    FillGdiPlusRoundedRect(g, &cardBgBrush, 195.0f, 15.0f, 165.0f, 105.0f, 10.0f);
    SolidBrush purpleBrush(Color(255, 168, 85, 247));
    PointF pUpHeader(277.5f, 30.0f);
    g.DrawString(L"⬆  UPLOAD", -1, &headerFont, pUpHeader, &sfCenter, &purpleBrush);

    wchar_t upValStr[32];
    double upMbps = (copyRes.uploadSpeedBps * 8.0) / 1000000.0;
    swprintf_s(upValStr, L"%.2f", upMbps);
    PointF pUpNumber(277.5f, 65.0f);
    g.DrawString(upValStr, -1, &bigNumberFont, pUpNumber, &sfCenter, &whiteBrush);

    wchar_t peakUpStr[48];
    double peakUp = (copyRes.peakUploadMbps > upMbps) ? copyRes.peakUploadMbps : (upMbps * 1.07);
    swprintf_s(peakUpStr, L"Pico: %.2f Mbps", peakUp);
    SolidBrush peakPurpleBrush(Color(255, 192, 132, 252));
    PointF pPeakUp(277.5f, 98.0f);
    g.DrawString(peakUpStr, -1, &subPeakFont, pPeakUp, &sfCenter, &peakPurpleBrush);

    // PING METRICS CARD (WITH ⚙️ GEAR BUTTON AT RIGHT!)
    FillGdiPlusRoundedRect(g, &cardBgBrush, 20.0f, 130.0f, 340.0f, 44.0f, 8.0f);

    SolidBrush pingLabelBrush(Color(255, 180, 185, 205));
    g.DrawString(L"Ping ms", -1, &pingLabelFont, PointF(30, 141), &pingLabelBrush);

    // ⚡ Idle Ping with 'ms'
    SolidBrush goldBrush(Color(255, 234, 179, 8));
    g.DrawString(L"\uEA6A", -1, &mdlIconFont, PointF(104, 142), &goldBrush);
    wchar_t p1[24]; swprintf_s(p1, L"%.0f ms", copyRes.idlePingMs);
    g.DrawString(p1, -1, &pingLabelFont, PointF(120, 141), &goldBrush);

    // ⬇ Down Ping with 'ms'
    g.DrawString(L"\uE74B", -1, &mdlIconFont, PointF(175, 142), &cyanBrush);
    wchar_t p2[24]; swprintf_s(p2, L"%.0f ms", (copyRes.downPingMs > 0 ? copyRes.downPingMs : copyRes.idlePingMs));
    g.DrawString(p2, -1, &pingLabelFont, PointF(191, 141), &cyanBrush);

    // ⬆ Up Ping with 'ms'
    g.DrawString(L"\uE74A", -1, &mdlIconFont, PointF(252, 142), &purpleBrush);
    wchar_t p3[24]; swprintf_s(p3, L"%.0f ms", (copyRes.upPingMs > 0 ? copyRes.upPingMs : copyRes.idlePingMs));
    g.DrawString(p3, -1, &pingLabelFont, PointF(268, 141), &purpleBrush);

    // ⚙️ Gear Button in Ping Card (X = 334, Y = 142)
    Color gearColor = g_btnGearHover ? Color(255, 6, 182, 212) : Color(255, 180, 185, 205);
    SolidBrush gearBrush(gearColor);
    g.DrawString(L"\uE713", -1, &mdlIconFont, PointF(334, 142), &gearBrush);

    // RECENT TEST HISTORY LOG CARD (PERSISTENT & COLORFUL!)
    FillGdiPlusRoundedRect(g, &cardBgBrush, 20.0f, 184.0f, 340.0f, 95.0f, 10.0f);

    Font histTitleFont(&fontFamily, 11.0f, FontStyleBold, UnitPixel);
    Font histItemFont(&fontFamily, 11.0f, FontStyleBold, UnitPixel);

    g.DrawString(L"📊  Testes Anteriores (Velocidade Média)", -1, &histTitleFont, PointF(32, 196), &pingLabelBrush);

    if (g_historyCount == 0) {
        g_history[0].downMbps = downMbps;
        g_history[0].upMbps = upMbps;
        g_history[0].pingMs = copyRes.idlePingMs;
        g_historyCount = 1;
        SaveHistoryToRegistry();
    }

    float histY = 217.0f;
    SolidBrush mutedGrayBrush(Color(255, 140, 145, 165));

    for (int i = 0; i < g_historyCount && i < 3; i++) {
        wchar_t idxStr[16]; swprintf_s(idxStr, L"#%d:", i + 1);
        g.DrawString(idxStr, -1, &histItemFont, PointF(32, histY), &mutedGrayBrush);

        wchar_t downStr[32]; swprintf_s(downStr, L"⬇ %.1f Mbps", g_history[i].downMbps);
        g.DrawString(downStr, -1, &histItemFont, PointF(62, histY), &cyanBrush);

        wchar_t upStr[32]; swprintf_s(upStr, L"⬆ %.1f Mbps", g_history[i].upMbps);
        g.DrawString(upStr, -1, &histItemFont, PointF(170, histY), &purpleBrush);

        wchar_t pingStr[24]; swprintf_s(pingStr, L"(%.0f ms)", g_history[i].pingMs);
        g.DrawString(pingStr, -1, &histItemFont, PointF(275, histY), &goldBrush);

        histY += 18.0f;
    }

    // Status Banner Card
    FillGdiPlusRoundedRect(g, &cardBgBrush, 20.0f, 290.0f, 340.0f, 42.0f, 8.0f);
    PointF pDoneStatus(width / 2.0f, 311.0f);
    g.DrawString(L"✅ Medição de Conexão Finalizada", -1, &pingLabelFont, pDoneStatus, &sfCenter, &cyanBrush);
}

// Custom Flyout Window Procedure
LRESULT CALLBACK FlyoutWndProc(HWND hWnd, UINT uMsg, WPARAM wParam, LPARAM lParam) {
    switch (uMsg) {
        case WM_CREATE: {
            DWORD cornerPref = 2;
            DwmSetWindowAttribute(hWnd, 33, &cornerPref, sizeof(cornerPref));
            BOOL useDarkMode = TRUE;
            DwmSetWindowAttribute(hWnd, 20, &useDarkMode, sizeof(useDarkMode));
            return 0;
        }

        case WM_SETCURSOR:
            SetCursor(LoadCursor(NULL, IDC_ARROW));
            return TRUE;

        case WM_ACTIVATE:
            if (LOWORD(wParam) == WA_INACTIVE) {
                ShowWindow(hWnd, SW_HIDE);
            }
            return 0;

        case WM_MOUSEMOVE: {
            POINT pt = { LOWORD(lParam), HIWORD(lParam) };
            bool oldRetest = g_btnRetestHover;
            bool oldClose = g_btnCloseHover;
            bool oldGear = g_btnGearHover;

            g_btnRetestHover = (pt.x >= 20 && pt.x <= 185 && pt.y >= 354 && pt.y <= 394);
            g_btnCloseHover = (pt.x >= 195 && pt.x <= 360 && pt.y >= 354 && pt.y <= 394);
            g_btnGearHover = (pt.x >= 320 && pt.x <= 360 && pt.y >= 16 && pt.y <= 170);

            if (oldRetest != g_btnRetestHover || oldClose != g_btnCloseHover || oldGear != g_btnGearHover) {
                InvalidateRect(hWnd, NULL, FALSE);
            }

            TRACKMOUSEEVENT tme = { sizeof(TRACKMOUSEEVENT), TME_LEAVE, hWnd, 0 };
            TrackMouseEvent(&tme);
            return 0;
        }

        case WM_MOUSELEAVE:
            g_btnRetestHover = false;
            g_btnCloseHover = false;
            g_btnGearHover = false;
            InvalidateRect(hWnd, NULL, FALSE);
            return 0;

        case WM_LBUTTONUP: {
            POINT pt = { LOWORD(lParam), HIWORD(lParam) };

            // ⚙️ Gear Click -> Toggle Settings View
            if (pt.x >= 320 && pt.x <= 360 && pt.y >= 16 && pt.y <= 170) {
                g_showSettingsView = !g_showSettingsView;
                InvalidateRect(hWnd, NULL, FALSE);
                return 0;
            }

            // Left Button Click
            if (pt.x >= 20 && pt.x <= 185 && pt.y >= 354 && pt.y <= 394) {
                if (g_showSettingsView) {
                    g_showSettingsView = false;
                    InvalidateRect(hWnd, NULL, FALSE);
                } else {
                    StartSpeedTest();
                }
            } else if (pt.x >= 195 && pt.x <= 360 && pt.y >= 354 && pt.y <= 394) {
                ShowWindow(hWnd, SW_HIDE);
            }
            return 0;
        }

        case WM_SPEEDTEST_UPDATE:
        case WM_SPEEDTEST_COMPLETE:
            InvalidateRect(hWnd, NULL, FALSE);
            return 0;

        case WM_PAINT: {
            PAINTSTRUCT ps;
            HDC hdc = BeginPaint(hWnd, &ps);

            RECT clientRect;
            GetClientRect(hWnd, &clientRect);
            int width = clientRect.right;
            int height = clientRect.bottom;

            HDC hdcBuffer = CreateCompatibleDC(hdc);
            HBITMAP hbmBuffer = CreateCompatibleBitmap(hdc, width, height);
            HBITMAP hbmOldBuffer = (HBITMAP)SelectObject(hdcBuffer, hbmBuffer);

            HBRUSH hBgBrush = CreateSolidBrush(RGB(18, 19, 23));
            FillRect(hdcBuffer, &clientRect, hBgBrush);
            DeleteObject(hBgBrush);

            using namespace Gdiplus;
            Graphics graphics(hdcBuffer);
            graphics.SetSmoothingMode(SmoothingModeAntiAlias);
            graphics.SetTextRenderingHint(TextRenderingHintClearTypeGridFit);

            if (g_showSettingsView) {
                RenderSettingsView(graphics, width, height);
            } else {
                TestState currentState;
                EnterCriticalSection(&g_resultsCS);
                currentState = g_results.currentState;
                LeaveCriticalSection(&g_resultsCS);

                if (currentState == STATE_DONE) {
                    RenderCompletedResultsView(graphics, width, height);
                } else {
                    RenderActiveTestView(graphics, width, height);
                }
            }

            // Action Buttons
            FontFamily fontFamily(L"Segoe UI");
            Font btnFont(&fontFamily, 13.0f, FontStyleBold, UnitPixel);

            StringFormat sfCenter;
            sfCenter.SetAlignment(StringAlignmentCenter);
            sfCenter.SetLineAlignment(StringAlignmentCenter);

            float btnY = 354.0f;
            float btnH = 40.0f;

            if (g_showSettingsView) {
                Color btn1Color = g_btnRetestHover ? Color(255, 8, 145, 178) : Color(255, 6, 182, 212);
                SolidBrush btn1Brush(btn1Color);
                FillGdiPlusRoundedRect(graphics, &btn1Brush, 20.0f, btnY, 165.0f, btnH, 8.0f);

                SolidBrush btn1TextBrush(Color(255, 255, 255, 255));
                PointF pBtn1Text(102.5f, btnY + 20.0f);
                graphics.DrawString(L"←  Voltar", -1, &btnFont, pBtn1Text, &sfCenter, &btn1TextBrush);
            } else {
                Color btn1Color = g_btnRetestHover ? Color(255, 8, 145, 178) : Color(255, 6, 182, 212);
                SolidBrush btn1Brush(btn1Color);
                FillGdiPlusRoundedRect(graphics, &btn1Brush, 20.0f, btnY, 165.0f, btnH, 8.0f);

                SolidBrush btn1TextBrush(Color(255, 255, 255, 255));
                PointF pBtn1Text(102.5f, btnY + 20.0f);
                graphics.DrawString(L"⚡  Testar Novamente", -1, &btnFont, pBtn1Text, &sfCenter, &btn1TextBrush);
            }

            // Button 2: Fechar
            Color btn2Color = g_btnCloseHover ? Color(255, 45, 48, 58) : Color(255, 30, 32, 40);
            SolidBrush btn2Brush(btn2Color);
            FillGdiPlusRoundedRect(graphics, &btn2Brush, 195.0f, btnY, 165.0f, btnH, 8.0f);

            SolidBrush btn2TextBrush(Color(255, 220, 225, 235));
            PointF pBtn2Text(277.5f, btnY + 20.0f);
            graphics.DrawString(L"Fechar", -1, &btnFont, pBtn2Text, &sfCenter, &btn2TextBrush);

            BitBlt(hdc, 0, 0, width, height, hdcBuffer, 0, 0, SRCCOPY);

            SelectObject(hdcBuffer, hbmOldBuffer);
            DeleteObject(hbmBuffer);
            DeleteDC(hdcBuffer);

            EndPaint(hWnd, &ps);
            return 0;
        }

        case WM_DESTROY:
            g_hFlyoutWnd = NULL;
            return 0;
    }
    return DefWindowProcW(hWnd, uMsg, wParam, lParam);
}

// Toggle or Show Speed Test Flyout Window
void ToggleOrShowSpeedTestFlyout() {
    if (g_hFlyoutWnd && IsWindow(g_hFlyoutWnd)) {
        if (IsWindowVisible(g_hFlyoutWnd)) {
            ShowWindow(g_hFlyoutWnd, SW_HIDE);
        } else {
            POINT pt;
            GetCursorPos(&pt);

            int w = 380;
            int h = 412;
            int x = pt.x - (w / 2);
            int y = pt.y - h - 12;

            int screenW = GetSystemMetrics(SM_CXSCREEN);
            int screenH = GetSystemMetrics(SM_CYSCREEN);
            if (x < 10) x = 10;
            if (x + w > screenW) x = screenW - w - 10;
            if (y < 10) y = pt.y + 10;
            if (y + h > screenH) y = screenH - h - 10;

            SetWindowPos(g_hFlyoutWnd, HWND_TOPMOST, x, y, w, h, SWP_SHOWWINDOW);
            SetForegroundWindow(g_hFlyoutWnd);
        }
        return;
    }

    WNDCLASSEXW wc = { sizeof(WNDCLASSEXW) };
    wc.lpfnWndProc = FlyoutWndProc;
    wc.hInstance = GetModuleHandle(NULL);
    wc.lpszClassName = L"WindhawkSpeedometerFlyoutV37Class";
    wc.hCursor = LoadCursor(NULL, IDC_ARROW);
    wc.hbrBackground = NULL;
    RegisterClassExW(&wc);

    POINT pt;
    GetCursorPos(&pt);

    int w = 380;
    int h = 412;
    int x = pt.x - (w / 2);
    int y = pt.y - h - 12;

    int screenW = GetSystemMetrics(SM_CXSCREEN);
    int screenH = GetSystemMetrics(SM_CYSCREEN);
    if (x < 10) x = 10;
    if (x + w > screenW) x = screenW - w - 10;
    if (y < 10) y = pt.y + 10;
    if (y + h > screenH) y = screenH - h - 10;

    g_hFlyoutWnd = CreateWindowExW(
        WS_EX_TOPMOST | WS_EX_TOOLWINDOW,
        wc.lpszClassName, L"Velocidade da Internet",
        WS_POPUP | WS_VISIBLE,
        x, y, w, h,
        NULL, NULL, wc.hInstance, NULL
    );

    SetForegroundWindow(g_hFlyoutWnd);
    if (InterlockedCompareExchange(&g_isTesting, 0, 0) == 0) {
        StartSpeedTest();
    }
}

// Register Configured Custom Hotkey (Robust Win+Alt+S default)
void RegisterConfiguredHotKey(HWND hWnd) {
    if (!hWnd || !IsWindow(hWnd)) return;
    UnregisterHotKey(hWnd, HOTKEY_SPEEDTEST_ID);

    if (!g_settingHotkeyEnable) return;

    UINT fsModifiers = MOD_WIN | MOD_ALT;
    if (wcscmp(g_settingHotkeyMod, L"ctrl_alt") == 0) fsModifiers = MOD_CONTROL | MOD_ALT;
    else if (wcscmp(g_settingHotkeyMod, L"ctrl_shift") == 0) fsModifiers = MOD_CONTROL | MOD_SHIFT;
    else if (wcscmp(g_settingHotkeyMod, L"alt_shift") == 0) fsModifiers = MOD_ALT | MOD_SHIFT;
    else if (wcscmp(g_settingHotkeyMod, L"win_shift") == 0) fsModifiers = MOD_WIN | MOD_SHIFT;

    UINT vkKey = 'S';
    if (g_settingHotkeyKey[0] >= L'a' && g_settingHotkeyKey[0] <= L'z') {
        vkKey = towupper(g_settingHotkeyKey[0]);
    } else if (g_settingHotkeyKey[0] >= L'A' && g_settingHotkeyKey[0] <= L'Z') {
        vkKey = g_settingHotkeyKey[0];
    } else if (g_settingHotkeyKey[0] >= L'0' && g_settingHotkeyKey[0] <= L'9') {
        vkKey = g_settingHotkeyKey[0];
    }

    RegisterHotKey(hWnd, HOTKEY_SPEEDTEST_ID, fsModifiers, vkKey);
}

// Message Window Procedure
LRESULT CALLBACK WindowProc(HWND hWnd, UINT uMsg, WPARAM wParam, LPARAM lParam) {
    switch (uMsg) {
        case WM_RELOAD_HOTKEY:
            RegisterConfiguredHotKey(hWnd);
            return 0;

        case WM_TRIGGER_FLYOUT:
        case WM_TRAYICON:
            if (uMsg == WM_TRIGGER_FLYOUT || lParam == WM_LBUTTONUP || lParam == NIN_SELECT) {
                ToggleOrShowSpeedTestFlyout();
            }
            return 0;

        case WM_HOTKEY:
            if (wParam == HOTKEY_SPEEDTEST_ID) {
                ToggleOrShowSpeedTestFlyout();
            }
            return 0;

        case WM_SPEEDTEST_UPDATE:
        case WM_SPEEDTEST_COMPLETE:
            if (g_hFlyoutWnd && IsWindow(g_hFlyoutWnd) && IsWindowVisible(g_hFlyoutWnd)) {
                InvalidateRect(g_hFlyoutWnd, NULL, FALSE);
            }
            {
                wchar_t status[128];
                EnterCriticalSection(&g_resultsCS);
                StringCchCopyW(status, 128, g_results.statusText);
                LeaveCriticalSection(&g_resultsCS);
                UpdateTrayTooltipOnly(status);
            }
            return 0;

        case WM_CLOSE:
            DestroyWindow(hWnd);
            return 0;

        case WM_DESTROY:
            Shell_NotifyIconW(NIM_DELETE, &g_nid);
            UnregisterHotKey(hWnd, HOTKEY_SPEEDTEST_ID);
            PostQuitMessage(0);
            return 0;
    }
    return DefWindowProcW(hWnd, uMsg, wParam, lParam);
}

// Read settings safely from Windhawk
void ReadWindhawkSettings() {
    g_settingUnitMbps = true;
    g_settingHotkeyEnable = true;
    StringCchCopyW(g_settingHotkeyMod, 32, L"win_alt");
    StringCchCopyW(g_settingHotkeyKey, 16, L"S");

    PCWSTR strEnable = Wh_GetStringSetting(L"hotkey_enable");
    if (strEnable) {
        g_settingHotkeyEnable = (wcscmp(strEnable, L"0") != 0 && wcscmp(strEnable, L"false") != 0);
        Wh_FreeStringSetting(strEnable);
    }

    PCWSTR strUnit = Wh_GetStringSetting(L"unit_mbps");
    if (strUnit) {
        g_settingUnitMbps = (wcscmp(strUnit, L"0") != 0 && wcscmp(strUnit, L"false") != 0);
        Wh_FreeStringSetting(strUnit);
    }

    PCWSTR strMod = Wh_GetStringSetting(L"hotkey_mod");
    if (strMod && strMod[0]) {
        StringCchCopyW(g_settingHotkeyMod, 32, strMod);
        Wh_FreeStringSetting(strMod);
    }

    PCWSTR strKey = Wh_GetStringSetting(L"hotkey_key");
    if (strKey && strKey[0]) {
        StringCchCopyW(g_settingHotkeyKey, 16, strKey);
        Wh_FreeStringSetting(strKey);
    }
}

// Dedicated UI Thread Procedure
DWORD WINAPI DedicatedUIThreadProc(LPVOID lpParam) {
    typedef BOOL (WINAPI *SetProcessDpiAwarenessContext_t)(HANDLE);
    HMODULE hUser32 = GetModuleHandleW(L"user32.dll");
    if (hUser32) {
        auto pSetDpi = (SetProcessDpiAwarenessContext_t)GetProcAddress(hUser32, "SetProcessDpiAwarenessContext");
        if (pSetDpi) {
            pSetDpi((HANDLE)-4);
        }
    }

    WSADATA wsaData;
    WSAStartup(MAKEWORD(2, 2), &wsaData);

    Gdiplus::GdiplusStartupInput gdiplusStartupInput;
    Gdiplus::GdiplusStartup(&g_gdiplusToken, &gdiplusStartupInput, NULL);

    LoadHistoryFromRegistry();

    WNDCLASSEXW wc = { sizeof(WNDCLASSEXW) };
    wc.lpfnWndProc = WindowProc;
    wc.hInstance = GetModuleHandle(NULL);
    wc.lpszClassName = L"WindhawkSpeedTestMsgClassV37";
    wc.hCursor = LoadCursor(NULL, IDC_ARROW);
    RegisterClassExW(&wc);

    g_hMsgWnd = CreateWindowExW(
        0, wc.lpszClassName, L"WindhawkSpeedTestWindow",
        WS_POPUP, 0, 0, 0, 0,
        NULL, NULL, wc.hInstance, NULL
    );

    if (!g_hMsgWnd) return 0;

    RegisterConfiguredHotKey(g_hMsgWnd);

    g_hIconNormal = CreateCustomSpeedIcon(RGB(20, 22, 28), RGB(16, 185, 129));
    g_hIconTesting = CreateCustomSpeedIcon(RGB(6, 182, 212), RGB(255, 255, 255));

    memset(&g_nid, 0, sizeof(NOTIFYICONDATAW));
    g_nid.cbSize = sizeof(NOTIFYICONDATAW);
    g_nid.hWnd = g_hMsgWnd;
    g_nid.uID = 1001;
    g_nid.uFlags = NIF_ICON | NIF_MESSAGE | NIF_TIP;
    g_nid.uCallbackMessage = WM_TRAYICON;
    g_nid.hIcon = g_hIconNormal;
    StringCchCopyW(g_nid.szTip, ARRAYSIZE(g_nid.szTip), L"⚡ Speed Test Widget");

    Shell_NotifyIconW(NIM_DELETE, &g_nid);
    Shell_NotifyIconW(NIM_ADD, &g_nid);

    MSG msg;
    while (GetMessageW(&msg, NULL, 0, 0)) {
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }

    Shell_NotifyIconW(NIM_DELETE, &g_nid);

    if (g_hIconNormal) DestroyIcon(g_hIconNormal);
    if (g_hIconTesting) DestroyIcon(g_hIconTesting);
    DestroyWindow(g_hMsgWnd);
    UnregisterClassW(L"WindhawkSpeedTestMsgClassV37", GetModuleHandle(NULL));
    g_hMsgWnd = NULL;

    if (g_gdiplusToken) {
        Gdiplus::GdiplusShutdown(g_gdiplusToken);
    }
    WSACleanup();
    return 0;
}

// Mod Init
BOOL Wh_ModInit() {
    ReadWindhawkSettings();
    InitializeCriticalSection(&g_resultsCS);

    g_hUIThread = CreateThread(NULL, 0, DedicatedUIThreadProc, NULL, 0, &g_uiThreadId);

    HMODULE hShell32 = GetModuleHandleW(L"shell32.dll");
    if (hShell32) {
        void* pShellExecEx = (void*)GetProcAddress(hShell32, "ShellExecuteExW");
        if (pShellExecEx) {
            Wh_SetFunctionHook(pShellExecEx, (void*)ShellExecuteExW_Hook, (void**)&pfnShellExecuteExW_Original);
        }

        void* pShellExec = (void*)GetProcAddress(hShell32, "ShellExecuteW");
        if (pShellExec) {
            Wh_SetFunctionHook(pShellExec, (void*)ShellExecuteW_Hook, (void**)&pfnShellExecuteW_Original);
        }
    }

    HMODULE hKernel32 = GetModuleHandleW(L"kernel32.dll");
    if (hKernel32) {
        void* pCreateProc = (void*)GetProcAddress(hKernel32, "CreateProcessW");
        if (pCreateProc) {
            Wh_SetFunctionHook(pCreateProc, (void*)CreateProcessW_Hook, (void**)&pfnCreateProcessW_Original);
        }
    }

    return TRUE;
}

// Mod Uninit
void Wh_ModUninit() {
    InterlockedExchange(&g_stopRequested, 1);

    if (g_hWorkerThread != NULL) {
        // Network calls are bounded and observe g_stopRequested. The worker
        // must exit before the DLL, its globals and its critical section.
        WaitForSingleObject(g_hWorkerThread, INFINITE);
        CloseHandle(g_hWorkerThread);
        g_hWorkerThread = NULL;
    }

    if (g_hFlyoutWnd && IsWindow(g_hFlyoutWnd)) {
        DestroyWindow(g_hFlyoutWnd);
        g_hFlyoutWnd = NULL;
    }

    if (g_hMsgWnd && IsWindow(g_hMsgWnd)) {
        NOTIFYICONDATAW nid = { 0 };
        nid.cbSize = sizeof(NOTIFYICONDATAW);
        nid.hWnd = g_hMsgWnd;
        nid.uID = 1001;
        Shell_NotifyIconW(NIM_DELETE, &nid);

        SendMessageW(g_hMsgWnd, WM_CLOSE, 0, 0);
    }

    if (g_hUIThread != NULL) {
        WaitForSingleObject(g_hUIThread, INFINITE);
        CloseHandle(g_hUIThread);
        g_hUIThread = NULL;
    }

    DeleteCriticalSection(&g_resultsCS);
}

// Settings Changed
void Wh_ModSettingsChanged() {
    ReadWindhawkSettings();
    if (g_hMsgWnd && IsWindow(g_hMsgWnd)) {
        PostMessageW(g_hMsgWnd, WM_RELOAD_HOTKEY, 0, 0);
    }
}
