@echo off
rem SWAT: Urban Siege - local launcher (the game must be served over http, not opened as a file)
cd /d "%~dp0"
set PORT=8080
echo Starting local web server on http://localhost:%PORT%/ ...
where python >nul 2>nul
if %errorlevel%==0 (
  start "" "http://localhost:%PORT%/index.html"
  python -m http.server %PORT%
  goto :eof
)
where py >nul 2>nul
if %errorlevel%==0 (
  start "" "http://localhost:%PORT%/index.html"
  py -3 -m http.server %PORT%
  goto :eof
)
where npx >nul 2>nul
if %errorlevel%==0 (
  start "" "http://localhost:%PORT%/index.html"
  npx --yes serve -l %PORT% .
  goto :eof
)
echo.
echo Could not find Python or Node.js.
echo Install Python from https://www.python.org/downloads/ (tick "Add to PATH") and run this file again.
pause
