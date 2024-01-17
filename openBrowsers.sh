#!/bin/bash
# 打开新的终端并执行命令
osascript -e 'tell application "Terminal" to do script "echo -n -e \"\\033]0;9222download\\007\" && /Applications/QQBrowser.app/Contents/MacOS/QQBrowser -user-data-dir=\"/Users/zhymacbookair/IdeaProjects/download_browsers/9222download\" --new-window --load-extension=/Users/zhymacbookair/IdeaProjects/download-videos-from-youtube https://localhost:9222/downloadyoutube/bili/百年答辩"'
osascript -e 'tell application "Terminal" to do script "echo -n -e \"\\033]0;9228download\\007\" && /Applications/QQBrowser.app/Contents/MacOS/QQBrowser -user-data-dir=\"/Users/zhymacbookair/IdeaProjects/download_browsers/9228download\" --new-window --load-extension=/Users/zhymacbookair/IdeaProjects/download-videos-from-youtube https://localhost:9228/downloadyoutube/xigw/云卷花开"'
