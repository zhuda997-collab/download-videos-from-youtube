// (2026-06-15) popup.js 错误修复:
// 1) 加 null 防御 — service worker 加载失败时 response 可能 undefined
// 2) 加 button 存在性检查 — 避免 querySelector 返 null 报错
// 3) checkOsGetFilePath 加 Linux fallback 和错误处理
// 4) 重构成多行格式 (原文件是 Windows 单行风格, 不好维护)

$(function () {
    var filePath;

    async function loadFilePathAndSetup() {
        try {
            filePath = await checkOsGetFilePath();
            console.log('[popup] filePath loaded:', filePath);
        } catch (e) {
            console.error('[popup] loadFilePathAndSetup failed:', e);
        }
    }
    loadFilePathAndSetup();

    // 从 background 拉 sharedData, 设到 input
    chrome.runtime.sendMessage({action: 'getSharedData'}, function (response) {
        // 防御: response 可能 undefined (background.js 没起来 / manifest 没配)
        if (chrome.runtime.lastError) {
            console.error('[popup] getSharedData lastError:', chrome.runtime.lastError.message);
            return;
        }
        if (!response) {
            console.warn('[popup] getSharedData response is undefined, 跳过 input 填充');
            return;
        }
        if (response.folderPort !== undefined) {
            $('#inputNumber').val(response.folderPort);
        }
        if (response.num !== undefined) {
            $('#num').val(response.num);
        }

        // 绑定 confirmButton onclick
        var confirmBtn = document.getElementById('confirmButton');
        if (!confirmBtn) {
            console.error('[popup] confirmButton 元素不存在, 跳过 onclick 绑定');
            return;
        }
        confirmBtn.onclick = function () {
            var datas = {};
            datas.folderPort = $('#inputNumber').val();
            datas.num = $('#num').val();
            datas.filePath = filePath;

            // 这里的值只是添加到了 popup.html 中, 并没有在上下文中
            try {
                window.localStorage.setItem('num', datas.num);
                window.localStorage.setItem('folderPort', datas.folderPort);
                window.localStorage.setItem('filePath', filePath);
                window.localStorage.setItem('destination', filePath + datas.folderPort);
            } catch (e) {
                console.error('[popup] localStorage 写入失败:', e);
            }

            console.info('datas:' + JSON.stringify(datas));
            chrome.runtime.sendMessage({action: 'pageDatas', value: datas});
            // Close the popup
            window.close();
        };
    });

    // 绑定 clear_refresh_num onclick
    // (2026-06-15) 加 button 存在性检查
    var clearRefreshBtn = document.getElementById('clear_refresh_num');
    if (clearRefreshBtn) {
        clearRefreshBtn.onclick = function () {
            // 向当前活动标签页发送消息
            chrome.tabs.query({active: true, currentWindow: true}, function (tabs) {
                if (!tabs || tabs.length === 0) {
                    console.warn('[popup] 当前 tab 查不到, 跳过 clearTimes1');
                    return;
                }
                var tabId = tabs[0].id;
                chrome.tabs.sendMessage(tabId, {action: 'clearTimes1'});
            });
        };
    } else {
        console.warn('[popup] clear_refresh_num 按钮不存在, 跳过 onclick 绑定');
    }
});

var checkOsGetFilePath = async function () {
    // (2026-06-15) 加 try/catch + 错误处理
    var response;
    try {
        response = await fetch('config.json');
    } catch (e) {
        console.error('[popup] fetch config.json 失败:', e);
        throw e;
    }
    if (!response.ok) {
        throw new Error('config.json HTTP ' + response.status);
    }
    var data = await response.json();
    if (!data.upload_files) {
        throw new Error('config.json 里没有 upload_files 字段');
    }
    var upload_files_path = data.upload_files;
    console.log('fetch upload_files_path data:' + upload_files_path);

    var os = navigator.platform;
    if (os.startsWith('Mac')) {
        console.log('mac path :' + upload_files_path);
        return upload_files_path;
    } else if (os.startsWith('Win')) {
        return upload_files_path;
    } else {
        // (2026-06-15) 加 Linux/其他 fallback, 原代码没处理会 return undefined
        console.warn('[popup] 未知 OS: ' + os + ', 仍然用 config 路径: ' + upload_files_path);
        return upload_files_path;
    }
};
