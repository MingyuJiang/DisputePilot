@echo off
setlocal DisableDelayedExpansion
if not defined DP_PYTHON set "DP_PYTHON=python"
"%DP_PYTHON%" -c "import sys;sys.exit(0 if sys.version_info >= (3,11) else 2)" >nul 2>nul
if errorlevel 1 (
  echo Python 3.11+ is required. Set DP_PYTHON to its executable path.
  exit /b 2
)
"%DP_PYTHON%" "%~dp0scripts\launcher.py" %*
exit /b %ERRORLEVEL%
