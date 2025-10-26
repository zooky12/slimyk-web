@echo off
setlocal EnableExtensions EnableDelayedExpansion
pushd "%~dp0" >nul 2>&1

set "UPDATED="

rem ---- temp workspace
set "TMP=%TEMP%\gen_levels_%RANDOM%%RANDOM%"
md "%TMP%" >nul 2>&1

rem ================= A) worlds.json =================
set "WORLDS_RAW=%TMP%\worlds.raw"
set "WORLDS_KEEP=%TMP%\worlds.keep"
set "WORLDS_SORT=%TMP%\worlds.sort"
del /f /q "%WORLDS_RAW%" "%WORLDS_KEEP%" "%WORLDS_SORT%" >nul 2>&1

dir /b /ad > "%WORLDS_RAW%" 2>nul

if not exist "%WORLDS_RAW%" (
  > "worlds.json" echo [
  >>"worlds.json" echo ]
  set "UPDATED=%UPDATED% worlds.json"
  goto :MAIN
)

for /f "usebackq delims=" %%D in ("%WORLDS_RAW%") do (
  set "W=%%D"
  set "C=!W:~0,1!"
  if /I not "!C!"=="_" if /I not "!C!"=="." (
    >>"%WORLDS_KEEP%" echo %%D
  )
)
if not exist "%WORLDS_KEEP%" (
  > "worlds.json" echo [
  >>"worlds.json" echo ]
  set "UPDATED=%UPDATED% worlds.json"
  goto :MAIN
)

sort "%WORLDS_KEEP%" /O "%WORLDS_SORT%" >nul

set "WORLDS_JSON_NEW=%TMP%\worlds.new.json"
> "%WORLDS_JSON_NEW%" echo [
set "first=1"
for /f "usebackq delims=" %%D in ("%WORLDS_SORT%") do (
  if defined first (
    >>"%WORLDS_JSON_NEW%" echo   "%%~nD"
    set "first="
  ) else (
    >>"%WORLDS_JSON_NEW%" echo   ,"%%~nD"
  )
)
>>"%WORLDS_JSON_NEW%" echo ]
if not exist "worlds.json" (
  copy /y "%WORLDS_JSON_NEW%" "worlds.json" >nul
  set "UPDATED=%UPDATED% worlds.json"
) else (
  fc /b "%WORLDS_JSON_NEW%" "worlds.json" >nul
  if errorlevel 1 (
    copy /y "%WORLDS_JSON_NEW%" "worlds.json" >nul
    set "UPDATED=%UPDATED% worlds.json"
  )
)

:MAIN
rem ================ B) each world\index.json =================
if not exist "%WORLDS_SORT%" goto :SUMMARY

for /f "usebackq delims=" %%D in ("%WORLDS_SORT%") do (
  call :BuildIndex "%%D"
)
goto :SUMMARY


:BuildIndex
setlocal EnableDelayedExpansion
set "WORLD=%~1"

set "LIST_SORTED=%TMP%\!WORLD!.sorted.list"
del /f /q "!LIST_SORTED!" >nul 2>&1

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$w = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath('%CD%\\%WORLD%');" ^
  "if (Test-Path -LiteralPath $w) {" ^
  "  Get-ChildItem -LiteralPath $w -File -Filter '*.json' |" ^
  "    Where-Object { $_.Name -ne 'index.json' } |" ^
  "    Sort-Object @{ Expression = { $t = ($_.BaseName -split '-',2)[0]; $n = 0; if ([int]::TryParse($t,[ref]$n)) { $n } else { [int]::MaxValue } } }, Name |" ^
  "    Select-Object -ExpandProperty Name" ^
  "} " > "!LIST_SORTED!" 2>nul

set "IDX_NEW=%TMP%\!WORLD!.index.new.json"
> "!IDX_NEW!" echo [
set "FST=1"
if exist "!LIST_SORTED!" (
  for /f "usebackq delims=" %%F in ("!LIST_SORTED!") do (
    if defined FST (
      >>"!IDX_NEW!" echo   "%%F"
      set "FST="
    ) else (
      >>"!IDX_NEW!" echo   ,"%%F"
    )
  )
)
>>"!IDX_NEW!" echo ]

if not exist "!WORLD!\index.json" (
  copy /y "!IDX_NEW!" "!WORLD!\index.json" >nul
  endlocal & set "UPDATED=%UPDATED% %WORLD%\index.json" & goto :eof
) else (
  fc /b "!IDX_NEW!" "!WORLD!\index.json" >nul
  if errorlevel 1 (
    copy /y "!IDX_NEW!" "!WORLD!\index.json" >nul
    endlocal & set "UPDATED=%UPDATED% %WORLD%\index.json" & goto :eof
  )
)

endlocal
goto :eof


:SUMMARY
if defined UPDATED (
  echo Updated: %UPDATED%
) else (
  echo Everything up to date.
)

rd /s /q "%TMP%" >nul 2>&1
popd >nul 2>&1
endlocal
