@echo off
cd /d "%~dp0"
set "agent_node=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if exist "%agent_node%" (
  "%agent_node%" launch.mjs
) else (
  node launch.mjs
)
if errorlevel 1 pause
