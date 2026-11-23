@echo off
rem Starts the Org Chart Sandbox on this computer only (127.0.0.1) and opens it in your browser.
rem Close this window to stop it.
cd /d "%~dp0"
set PORT=8791
echo Org Chart Sandbox: http://127.0.0.1:%PORT%/   (close this window to stop)
start "" "http://127.0.0.1:%PORT%/"
python -m http.server %PORT% --bind 127.0.0.1
