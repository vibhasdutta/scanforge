@echo off
setlocal
if exist "%~dp0..\..\node_bin.txt" (
  for /f "delims=" %%i in ('type "%~dp0..\..\node_bin.txt"') do (
    if exist "%%i" (
      "%%i" "%~dp0native-host.js" %*
      exit /b %ERRORLEVEL%
    )
  )
)
if exist "C:\Program Files\nodejs\node.exe" (
  "C:\Program Files\nodejs\node.exe" "%~dp0native-host.js" %*
  exit /b %ERRORLEVEL%
)
node "%~dp0native-host.js" %*
