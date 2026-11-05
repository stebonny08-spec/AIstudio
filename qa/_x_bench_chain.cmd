@echo off
setlocal
del "%~dp0_x_bench_status.txt" 2>nul
tools\llama-bench.exe -m tools\models\spark-x2.6-1.7b.gguf -p 512 -n 128 > qa\_x_bench_up_17b.log 2>&1
if errorlevel 1 (echo FAIL17UP>>qa\_x_bench_status.txt) else (echo OK17UP>>qa\_x_bench_status.txt)
tools\llama-bench.exe -m tools\models\spark-x2.6-4b.gguf -p 512 -n 128 > qa\_x_bench_up_4b.log 2>&1
if errorlevel 1 (echo FAIL4BUP>>qa\_x_bench_status.txt) else (echo OK4BUP>>qa\_x_bench_status.txt)
tools\llama-xhtoken\build\bin\llama-bench.exe -m tools\models\spark-x2.6-1.7b.gguf -p 512 -n 128 > qa\_x_bench_xt_17b.log 2>&1
if errorlevel 1 (echo FAIL17XT>>qa\_x_bench_status.txt) else (echo OK17XT>>qa\_x_bench_status.txt)
tools\llama-xhtoken\build\bin\llama-bench.exe -m tools\models\spark-x2.6-4b.gguf -p 512 -n 128 > qa\_x_bench_xt_4b.log 2>&1
if errorlevel 1 (echo FAIL4BXT>>qa\_x_bench_status.txt) else (echo OK4BXT>>qa\_x_bench_status.txt)
echo CHAIN_DONE>>qa\_x_bench_status.txt
