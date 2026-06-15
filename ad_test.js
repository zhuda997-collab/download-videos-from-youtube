#!/usr/bin/env node
/**
 * ad_test.js — Node mock test for autoDownload.js (双保险触发 downie)
 * 测试日期: 2026-06-15 09:46
 *
 * 测什么:
 *   1. 主路径 sendMessage → background.js openDownieUrl → chrome.tabs.create 完整流程
 *   2. 重试逻辑 (3 次 sendMessage 失败 → 才走兜底)
 *   3. 兜底 window.open (仅 user gesture 在手时执行)
 *   4. user gesture 决策:
 *      - trigger=user-click → 兜底可用
 *      - trigger=auto-config / auto-timeout → 兜底跳过 (程序触发, gesture 丢失)
 *   5. 重复下载检测 (localStorage 已记录 → 跳过)
 *   6. URL 处理 (去除 pp 参数)
 *   7. background.js openDownieUrl handler: chrome.tabs.create {active:false} + sleep 1.2s
 *
 * Mock 框架:
 *   - chrome.runtime.sendMessage (模拟 sw 响应)
 *   - chrome.runtime.onMessage.addListener (接 content script 发来的消息)
 *   - chrome.tabs.create (验证 url 参数)
 *   - window.open (兜底路径, user gesture 决定是否能跑)
 *   - jQuery $ (autoDownload.js 用了 $)
 *   - document / navigator / window.localStorage
 *
 * 不依赖 jQuery/Chrome 真实环境, 纯 Node vm sandbox
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ============== 测试框架 ==============
let passed = 0, failed = 0;
const tests = [];

function test(name, fn) {
    tests.push({name, fn});
}

function assertEq(actual, expected, msg) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`${msg || 'assertEq failed'}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
    }
}

function assertTrue(cond, msg) {
    if (!cond) throw new Error(msg || 'assertTrue failed');
}

function assertContains(haystack, needle, msg) {
    if (!haystack.includes(needle)) {
        throw new Error(`${msg || 'assertContains failed'}\n  needle: ${needle}\n  haystack first 200: ${haystack.slice(0, 200)}`);
    }
}

// ============== Mock Chrome API ==============
function makeMockChrome(opts = {}) {
    const log = [];
    const sendResponses = opts.sendResponses || [];  // 队列, 每个调用 consume 一个
    let sendIdx = 0;
    let tabsCreateCalls = [];

    const chrome = {
        runtime: {
            sendMessage: (msg) => {
                log.push({type: 'sendMessage', msg});
                // (2026-06-15 09:46) 双策略 sendMessage mock:
                //   1. 队列注入 (sendResponses): 测试时可手动注入失败/成功响应
                //   2. 真实流程: 否则调 background listener (测主路径 sendMessage → sw tabs.create)
                if (sendIdx < sendResponses.length) {
                    const r = sendResponses[sendIdx++];
                    if (r.throw) return Promise.reject(new Error(r.throw));
                    return Promise.resolve(r);
                }
                if (chrome.runtime.onMessage._listeners.length === 0) {
                    return Promise.resolve({success: false, error: 'no listener'});
                }
                const listener = chrome.runtime.onMessage._listeners[0];
                const sender = {tab: {id: 1}};
                return new Promise((resolve, reject) => {
                    let resolved = false;
                    const sendResponse = (response) => {
                        if (resolved) return;
                        resolved = true;
                        resolve(response || {success: false, error: 'empty response'});
                    };
                    try {
                        listener(msg, sender, sendResponse);
                    } catch (e) {
                        reject(e);
                    }
                });
            },
            onMessage: {
                _listeners: [],
                addListener: (fn) => { chrome.runtime.onMessage._listeners.push(fn); },
            },
            lastError: null,
        },
        tabs: {
            // tabs.create 同步返回 Promise.resolve (避免 async function 的 microtask 推迟)
            create: (params) => {
                log.push({type: 'tabs.create', params});
                tabsCreateCalls.push(params);
                return Promise.resolve({id: tabsCreateCalls.length, url: params.url});
            },
        },
        storage: {
            local: {
                _data: {},
                get: (keys, cb) => {
                    const data = {};
                    (Array.isArray(keys) ? keys : [keys]).forEach(k => {
                        if (k in chrome.storage.local._data) data[k] = chrome.storage.local._data[k];
                    });
                    if (cb) cb(data);
                    return Promise.resolve(data);
                },
                set: (data, cb) => {
                    Object.assign(chrome.storage.local._data, data);
                    if (cb) cb();
                    return Promise.resolve();
                },
            },
        },
    };
    return {chrome, log, tabsCreateCalls, sendResponses, sendIdxRef: () => sendIdx};
}

// ============== Mock DOM / jQuery ==============
function makeMockDom() {
    const elements = [];
    const document = {
        createElement: (tag) => {
            const e = {
                tagName: tag,
                id: '',
                style: {},
                innerHTML: '',
                onclick: null,
                appendChild: function(child) {
                    this.children = this.children || [];
                    this.children.push(child);
                },
            };
            return e;
        },
        querySelectorAll: (sel) => {
            // 模拟 'h3 a' 选择器: 返回 num 个 mock <a> 元素
            return Array.from({length: 5}, (_, i) => ({
                href: 'https://www.youtube.com/watch?v=test' + (i+1),
                title: 'Test Video ' + (i+1),
                innerText: 'Test Video ' + (i+1),
                textContent: 'Test Video ' + (i+1),
                getAttribute: function(name) {
                    return name === 'href' ? this.href : name === 'title' ? this.title : null;
                },
            }));
        },
        getElementById: (id) => document.createElement('div'),
    };
    const $ = (selOrFn) => {
        // jQuery 兼容: $ 可以接受选择器字符串或 DOM ready 函数
        // 简化: $('#logo') 返回包含 appendChild 的元素
        //      $(function() {...}) 用 setTimeout 异步调用 (jQuery DOM ready 行为)
        //      异步执行是为了让 autoDownload.js 整文件先执行完 (var checkOs 等被赋值)
        if (typeof selOrFn === 'function') {
            setTimeout(selOrFn, 0);
            return {0: {appendChild: function(child) {}}, click: function() {}};
        }
        const el = {
            0: {
                appendChild: function(child) {},
            },
            click: function() {},
        };
        return el;
    };
    $.md5 = () => '';
    return {document, $};
}

// ============== Mock Window ==============
function makeMockWindow() {
    const listeners = {};
    const win = {
        localStorage: {
            _data: {},
            getItem: (k) => (k in win.localStorage._data) ? win.localStorage._data[k] : null,
            setItem: (k, v) => { win.localStorage._data[k] = String(v); },
            removeItem: (k) => { delete win.localStorage._data[k]; },
        },
        addEventListener: (event, fn) => {
            (listeners[event] = listeners[event] || []).push(fn);
        },
        dispatchEvent: (evt) => {
            const eventName = typeof evt === 'string' ? evt : evt.type;
            (listeners[eventName] || []).forEach(fn => fn(evt));
        },
        location: {reload: () => {}, href: 'https://www.youtube.com/feed/subscriptions'},
        navigator: {platform: 'MacIntel'},
        __downLoadAll: null,
        open: (url, target) => {
            win._openCalls = win._openCalls || [];
            win._openCalls.push({url, target});
            return {url};  // 模拟成功
        },
        setTimeout: setTimeout,
        clearTimeout: clearTimeout,
        Promise: Promise,
    };
    return win;
}

// navigator 直接暴露在 sandbox 顶层 (autoDownload.js 里用 navigator.platform)
function makeMockNavigator() {
    return {platform: 'MacIntel'};
}

// ============== 加载源代码到 sandbox ==============
function loadScript(code, sandbox) {
    vm.createContext(sandbox);
    vm.runInContext(code, sandbox, {filename: 'autoDownload.js'});
}

// ============== 等 DOM ready callback 跑完 (jQuery mock 用 setTimeout 0) ==============
function flushDomReady() {
    return new Promise(r => setTimeout(r, 10));
}

// ============== 主测试逻辑 ==============
async function main() {
    // ----- Test 1: 主路径 sendMessage → sw tabs.create -----
    test('T1 主路径: sendMessage 成功 → sw openDownieUrl handler 调 chrome.tabs.create (active:false)', async () => {
        const adCode = fs.readFileSync(path.join(__dirname, 'autoDownload.js'), 'utf8');
        const bgCode = fs.readFileSync(path.join(__dirname, 'background.js'), 'utf8');

        const {chrome, log, tabsCreateCalls} = makeMockChrome({
            sendResponses: [{success: true}],  // 第一次 sendMessage 返回 success
        });
        const {document, $} = makeMockDom();
        const win = makeMockWindow();

        const sandbox = {
            chrome, document, window: win, $,
            setTimeout, 
            clearTimeout, Promise, console,
            URL: URL,  // Node 10+ 内置
            fetch: () => Promise.resolve({ok: true, text: () => ''}),
        };
        sandbox.window.document = document;
        sandbox.navigator = makeMockNavigator();
        sandbox.global = sandbox;

        loadScript(adCode, sandbox);
        loadScript(bgCode, sandbox);
        await flushDomReady();

        // 模拟 content script 触发 downLoadVideo
        // 注意: downLoadVideo 是 var 声明, sandbox 里可以访问
        const ctx = vm.createContext(sandbox);
        const downLoadVideo = vm.runInContext('downLoadVideo', ctx);

        await downLoadVideo('https://www.youtube.com/watch?v=test1', 'Test Video 1', 0, 'user-click');

        // 验证: chrome.tabs.create 被调用, url 是 downie://XUOpenLink?url=...
        assertEq(tabsCreateCalls.length, 1, 'tabs.create 应被调 1 次');
        assertTrue(tabsCreateCalls[0].url.startsWith('downie://XUOpenLink?url='), 'url 应是 downie://...');
        assertEq(tabsCreateCalls[0].active, false, 'active 应是 false');
        assertTrue(tabsCreateCalls[0].url.includes('destination='), 'url 应包含 destination 参数');
    });

    // ----- Test 2: 重试 — 2 次失败 + 第 3 次成功 -----
    test('T2 重试: 前 2 次 sendMessage 失败 → 第 3 次成功', async () => {
        const adCode = fs.readFileSync(path.join(__dirname, 'autoDownload.js'), 'utf8');
        const bgCode = fs.readFileSync(path.join(__dirname, 'background.js'), 'utf8');

        const {chrome, log, tabsCreateCalls, sendIdxRef} = makeMockChrome({
            sendResponses: [
                {success: true},                          // 1st 给 getSharedData 占位
                {success: false, error: 'unknown action'},
                {success: false, error: 'timeout'},
            ],    // attempt 3 will call background listener (queue exhausted)
        });
        const {document, $} = makeMockDom();
        const win = makeMockWindow();

        const sandbox = {
            chrome, document, window: win, $,
            setTimeout, 
            clearTimeout, Promise, console,
            URL, fetch: () => Promise.resolve({ok: true, text: () => ''}),
        };
        sandbox.window.document = document;
        sandbox.navigator = makeMockNavigator();
        sandbox.global = sandbox;
        loadScript(adCode, sandbox);
        loadScript(bgCode, sandbox);
        await flushDomReady();

        const ctx = vm.createContext(sandbox);
        const downLoadVideo = vm.runInContext('downLoadVideo', ctx);

        await downLoadVideo('https://www.youtube.com/watch?v=test2', 'Test Video 2', 0, 'user-click');

        // 验证: 3 次 sendMessage + 1 次 tabs.create (第 3 次成功)
        const sendCount = log.filter(e => e.type === 'sendMessage' && e.msg.action === 'openDownieUrl').length;
        assertEq(sendCount, 3, '应 sendMessage 3 次');
        assertEq(tabsCreateCalls.length, 1, 'tabs.create 应调 1 次 (第 3 次成功)');
        assertTrue(tabsCreateCalls[0].url.includes('test2'), 'url 应包含 test2');
    });

    // ----- Test 3: 兜底 — 3 次失败 + trigger=user-click → 走 chrome.tabs.create (content script 上下文) -----
    test('T3 兜底: 3 次 sendMessage 失败 + user-click → 走 chrome.tabs.create(content script 上下文)', async () => {
        const adCode = fs.readFileSync(path.join(__dirname, 'autoDownload.js'), 'utf8');
        const bgCode = fs.readFileSync(path.join(__dirname, 'background.js'), 'utf8');

        const {chrome, log, tabsCreateCalls} = makeMockChrome({
            sendResponses: [
                {success: true},                          // 1st 给 getSharedData 占位
                {success: false, error: 'fail1'},
                {success: false, error: 'fail2'},
                {success: false, error: 'fail3'},
            ],
        });
        const {document, $} = makeMockDom();
        const win = makeMockWindow();

        const sandbox = {
            chrome, document, window: win, $,
            setTimeout, 
            clearTimeout, Promise, console,
            URL, fetch: () => Promise.resolve({ok: true, text: () => ''}),
        };
        sandbox.window.document = document;
        sandbox.navigator = makeMockNavigator();
        sandbox.global = sandbox;
        loadScript(adCode, sandbox);
        loadScript(bgCode, sandbox);
        await flushDomReady();

        const ctx = vm.createContext(sandbox);
        const downLoadVideo = vm.runInContext('downLoadVideo', ctx);

        await downLoadVideo('https://www.youtube.com/watch?v=test3', 'Test Video 3', 0, 'user-click');

        const sendCount = log.filter(e => e.type === 'sendMessage' && e.msg.action === 'openDownieUrl').length;
        assertEq(sendCount, 3, '应 sendMessage 3 次');
        // 兜底走 content script 的 chrome.tabs.create (3 次主路径都失败, 兜底补上)
        assertEq(tabsCreateCalls.length, 1, 'tabs.create 应被调 1 次 (兜底)');
        assertTrue(tabsCreateCalls[0].url.includes('test3'), '兜底 url 应包含 test3');
        assertEq(tabsCreateCalls[0].active, false, '兜底 active 应是 false');
    });

    // ----- Test 4: 兜底在 auto-config 下也跑 — chrome.tabs.create 不需要 user gesture -----
    test('T4 兜底在 auto-config 下也跑: chrome.tabs.create 不需要 user gesture', async () => {
        const adCode = fs.readFileSync(path.join(__dirname, 'autoDownload.js'), 'utf8');
        const bgCode = fs.readFileSync(path.join(__dirname, 'background.js'), 'utf8');

        const {chrome, log, tabsCreateCalls} = makeMockChrome({
            sendResponses: [
                {success: true},                          // 1st 给 getSharedData 占位
                {success: false, error: 'fail1'},
                {success: false, error: 'fail2'},
                {success: false, error: 'fail3'},
            ],
        });
        const {document, $} = makeMockDom();
        const win = makeMockWindow();

        const sandbox = {
            chrome, document, window: win, $,
            setTimeout, 
            clearTimeout, Promise, console,
            URL, fetch: () => Promise.resolve({ok: true, text: () => ''}),
        };
        sandbox.window.document = document;
        sandbox.navigator = makeMockNavigator();
        sandbox.global = sandbox;
        loadScript(adCode, sandbox);
        loadScript(bgCode, sandbox);
        await flushDomReady();

        const ctx = vm.createContext(sandbox);
        const downLoadVideo = vm.runInContext('downLoadVideo', ctx);

        await downLoadVideo('https://www.youtube.com/watch?v=test4', 'Test Video 4', 0, 'auto-config');

        // 兜底 chrome.tabs.create 现在对所有 trigger 都跑 (不需要 user gesture)
        assertEq(tabsCreateCalls.length, 1, '兜底 chrome.tabs.create 应被调 1 次 (auto-config 也能跑)');
        assertTrue(tabsCreateCalls[0].url.includes('test4'), '兜底 url 应包含 test4');
    });

    // ----- Test 5: 兜底在 auto-timeout 下也跑 — chrome.tabs.create 不需要 user gesture -----
    test('T5 兜底在 auto-timeout 下也跑: chrome.tabs.create 不需要 user gesture', async () => {
        const adCode = fs.readFileSync(path.join(__dirname, 'autoDownload.js'), 'utf8');
        const bgCode = fs.readFileSync(path.join(__dirname, 'background.js'), 'utf8');

        const {chrome, log, tabsCreateCalls} = makeMockChrome({
            sendResponses: [
                {success: true},                          // 1st 给 getSharedData 占位
                {success: false, error: 'fail1'},
                {success: false, error: 'fail2'},
                {success: false, error: 'fail3'},
            ],
        });
        const {document, $} = makeMockDom();
        const win = makeMockWindow();

        const sandbox = {
            chrome, document, window: win, $,
            setTimeout, 
            clearTimeout, Promise, console,
            URL, fetch: () => Promise.resolve({ok: true, text: () => ''}),
        };
        sandbox.window.document = document;
        sandbox.navigator = makeMockNavigator();
        sandbox.global = sandbox;
        loadScript(adCode, sandbox);
        loadScript(bgCode, sandbox);
        await flushDomReady();

        const ctx = vm.createContext(sandbox);
        const downLoadVideo = vm.runInContext('downLoadVideo', ctx);

        await downLoadVideo('https://www.youtube.com/watch?v=test5', 'Test Video 5', 0, 'auto-timeout');

        // 兜底 chrome.tabs.create 现在对所有 trigger 都跑 (不需要 user gesture)
        assertEq(tabsCreateCalls.length, 1, '兜底 chrome.tabs.create 应被调 1 次 (auto-timeout 也能跑)');
        assertTrue(tabsCreateCalls[0].url.includes('test5'), '兜底 url 应包含 test5');
    });

    // ----- Test 6: 重复下载检测 — localStorage 已有记录 → 跳过 -----
    test('T6 重复下载检测: localStorage 已记录 → downLoadVideo 跳过', async () => {
        const adCode = fs.readFileSync(path.join(__dirname, 'autoDownload.js'), 'utf8');
        const bgCode = fs.readFileSync(path.join(__dirname, 'background.js'), 'utf8');

        const {chrome, log, tabsCreateCalls} = makeMockChrome({
            sendResponses: [{success: true}],
        });
        const {document, $} = makeMockDom();
        const win = makeMockWindow();
        // 预先标记 test6 为已下载
        win.localStorage.setItem('https://www.youtube.com/watch?v=test6', '5');

        const sandbox = {
            chrome, document, window: win, $,
            setTimeout, 
            clearTimeout, Promise, console,
            URL, fetch: () => Promise.resolve({ok: true, text: () => ''}),
        };
        sandbox.window.document = document;
        sandbox.navigator = makeMockNavigator();
        sandbox.global = sandbox;
        loadScript(adCode, sandbox);
        loadScript(bgCode, sandbox);
        await flushDomReady();

        const ctx = vm.createContext(sandbox);
        const downLoadVideo = vm.runInContext('downLoadVideo', ctx);

        await downLoadVideo('https://www.youtube.com/watch?v=test6', 'Test Video 6', 0, 'user-click');

        // 验证: 不应 sendMessage, 不应 tabs.create
        const sendCount = log.filter(e => e.type === 'sendMessage' && e.msg.action === 'openDownieUrl').length;
        assertEq(sendCount, 0, '不应 sendMessage (重复)');
        assertEq(tabsCreateCalls.length, 0, '不应 tabs.create (重复)');
    });

    // ----- Test 7: background.js openDownieUrl handler — chrome.tabs.create {active:false} -----
    test('T7 background.js openDownieUrl handler: chrome.tabs.create {url, active:false} + 返回 success', async () => {
        const bgCode = fs.readFileSync(path.join(__dirname, 'background.js'), 'utf8');

        const {chrome, tabsCreateCalls} = makeMockChrome();
        const sandbox = {
            chrome, console, Promise,
            setTimeout, clearTimeout,
        };
        sandbox.global = sandbox;
        loadScript(bgCode, sandbox);

        const ctx = vm.createContext(sandbox);
        // chrome.runtime.onMessage.addListener 注册的 handler 在 chrome.runtime.onMessage._listeners[0]
        const listener = chrome.runtime.onMessage._listeners[0];
        assertTrue(typeof listener === 'function', 'background.js 应注册 onMessage listener');

        // 调用 listener 模拟 content script 发消息
        const req = {
            action: 'openDownieUrl',
            url: 'downie://XUOpenLink?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3Dtest7',
            index: 0,
        };
        // background.js listener 期望 3 个参数: (request, sender, sendResponse)
        // 返回 true 表示异步 sendResponse
        const result = await new Promise((resolve) => {
            const sendResponse = (r) => resolve(r);
            listener(req, {tab: {id: 1}}, sendResponse);
        });

        assertEq(tabsCreateCalls.length, 1, 'background handler 应调 tabs.create 1 次');
        assertTrue(tabsCreateCalls[0].url.startsWith('downie://'), 'url 应是 downie://');
        assertEq(tabsCreateCalls[0].active, false, 'active 应是 false');
        assertTrue(result && result.success, '应返回 success');
    });

    // ----- Test 8: URL 处理 — 去除 pp 参数 -----
    test('T8 URL 处理: 去除 pp 参数', async () => {
        const adCode = fs.readFileSync(path.join(__dirname, 'autoDownload.js'), 'utf8');
        const bgCode = fs.readFileSync(path.join(__dirname, 'background.js'), 'utf8');

        const {chrome, tabsCreateCalls} = makeMockChrome({
            sendResponses: [{success: true}],
        });
        const {document, $} = makeMockDom();
        const win = makeMockWindow();

        const sandbox = {
            chrome, document, window: win, $,
            setTimeout, 
            clearTimeout, Promise, console,
            URL, fetch: () => Promise.resolve({ok: true, text: () => ''}),
        };
        sandbox.window.document = document;
        sandbox.navigator = makeMockNavigator();
        sandbox.global = sandbox;
        loadScript(adCode, sandbox);
        loadScript(bgCode, sandbox);
        await flushDomReady();

        const ctx = vm.createContext(sandbox);
        const downLoadVideo = vm.runInContext('downLoadVideo', ctx);

        await downLoadVideo('https://www.youtube.com/watch?v=test8&pp=0gcJCX4JAYcqIYzv', 'Test Video 8', 0, 'user-click');

        // 验证 tabs.create 调用的 url 不含 pp 参数
        assertTrue(tabsCreateCalls.length === 1, 'tabs.create 应调 1 次');
        const createdUrl = tabsCreateCalls[0].url;
        assertTrue(!createdUrl.includes('pp=') || !createdUrl.match(/pp%3D/i), 'downie url 不应含 pp 参数');
        assertTrue(createdUrl.includes('test8'), 'url 应含 test8');
    });

    // ----- Test 9: bgConfigReady 事件链 -----
    test('T9 事件链: receiveMsgFromBgd → bgConfigReady → downLoadAll(auto-config)', async () => {
        const adCode = fs.readFileSync(path.join(__dirname, 'autoDownload.js'), 'utf8');
        const bgCode = fs.readFileSync(path.join(__dirname, 'background.js'), 'utf8');

        const {chrome, log, tabsCreateCalls} = makeMockChrome({
            sendResponses: [{success: true}],
        });
        const {document, $} = makeMockDom();
        const win = makeMockWindow();
        // 预置 destination/folderPort/num
        win.localStorage.setItem('destination', '/Users/test/Downloads');
        win.localStorage.setItem('folderPort', '9090');
        win.localStorage.setItem('num', '10');

        const sandbox = {
            chrome, document, window: win, $,
            setTimeout, 
            clearTimeout, Promise, console,
            URL, fetch: () => Promise.resolve({ok: true, text: () => ''}),
        };
        sandbox.window.document = document;
        sandbox.navigator = makeMockNavigator();
        sandbox.global = sandbox;
        loadScript(adCode, sandbox);
        loadScript(bgCode, sandbox);
        await flushDomReady();

        const ctx = vm.createContext(sandbox);

        // 模拟 background 推 config 回来 (通过 updateDestination 消息)
        const listener = chrome.runtime.onMessage._listeners[0];
        await listener({
            action: 'updateDestination',
            sharedData: {destination: '/Users/test/Downloads', num: '10', folderPort: '9090'},
        }, {tab: {id: 1}});

        // bgConfigReady 事件触发后, downLoadAll 会被调
        // 验证: window.__downLoadAll 应被设置 (在 $(function() { ... } 里)
        assertTrue(typeof win.__downLoadAll === 'function', '__downLoadAll 应被设置');
    });

    // ===== 运行所有测试 =====
    for (const t of tests) {
        try {
            await t.fn();
            passed++;
            console.log(`  ✓ ${t.name}`);
        } catch (e) {
            failed++;
            console.log(`  ✗ ${t.name}`);
            console.log(`    ${e.message}`);
        }
    }

    console.log(`\n=== ${passed} passed, ${failed} failed (out of ${tests.length}) ===`);
    process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
    console.error('FATAL:', e);
    process.exit(2);
});
