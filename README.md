# dsh-resizable-settings

让点击设置按钮弹出的那个设置框**可以拖动边和角改变大小**，也可以**按住顶部拖动位置**。

## 交互

| 操作 | 位置 |
|---|---|
| 左右改宽度 | 面板左/右边（内侧 6px 的窄带） |
| 上下改高度 | 面板上/下边 |
| 同时改宽高 | 四个角（16×16） |
| 移动到别处 | 面板**顶部 20px 横带**（空白的 header 上方） |
| 恢复默认大小与位置 | 在任意一条带上**连按两下** |

鼠标移到边缘时指针会变成对应的缩放光标；悬停时边缘会亮起一条细线，便于发现。

可拖动范围限制在 **DSH 顶部状态栏下方**：面板的顶边最低只能贴到顶栏下沿，不会被拖进顶栏里卡住。

大小和位置会记住，下次打开设置、甚至重启应用都保持。

## 它怎么做的

设置框由 `ui-settings-general` 渲染成一个 `role="dialog" aria-modal="true"` 的模态面板，外层是 `position:fixed; display:flex` 的居中容器，面板本身写死 `width:800px`，没有任何缩放能力。

几个必须踩对的地方：

- **把手必须画在面板内侧**。面板是 `overflow:hidden`，画在外面的把手会被裁掉 —— 看不见也点不到。
- **拖动前先把面板「钉住」**。flex 居中意味着加宽会往两边同时长；所以第一次按下时先把面板按当前 `getBoundingClientRect()` 转成 `position:absolute` + 显式 `left/top/width/height`，之后**被拖的那条边跟着鼠标，对面那条边不动**。
- **上限是视口，不是常数**。往东拖时能长到「右边缘贴住视口边距」为止，上限取决于左边缘在哪；这样拖动永远不会把面板顶出屏幕，也不会在撞到上限时让固定边跳动。
- **上边界是 DSH 顶栏的下沿，不是视口顶**。Windows 上标题栏是一条 40px 高的 `-webkit-app-region: drag` 带，且标题栏菜单栏宿主是 `z-index:1100`，**高于本模态的 `1000`** —— 指针落在那一带会被窗口拖动或菜单栏吃掉，根本到不了面板。所以面板一旦停进去，顶部的移动把手就再也收不到 `pointerdown`（鼠标也不变小手），面板等于被钉死、拖不回来。下边界取 DSH 自己发布的 `--dsh-frame-chrome-top`（标题栏高度，原生全屏时归零）；macOS 没有这条带，改用 `--dsh-frame-top-clearance`。普通浏览器文档两个变量都没有，退回 12px 边距。
- **右侧把手内缩 6px**。设置内容区的滚动条占着最外侧 5px（`--dsh-scrollbar-width`），压上去会把「拖滚动条」变成「改尺寸」。
- **角把手不会挡住关闭按钮**。header 是 `height:54px; padding:20px 14px 8px 10px`，关闭按钮 28×28 从 `y=20px` 起 —— 顶部 0–16px 那一圈是空的，所以角把手放在真正的角上也碰不到它。
- **双击重置不能靠 `dblclick`**。拖拽必须在 `pointerdown` 上 `preventDefault()`，而它会连带抑制 `dblclick` 依赖的兼容鼠标事件，所以改成自己在 400ms 内数两次按下。

面板是 React portal，开开关关会重新挂载，所以把手由 `MutationObserver` 发现并挂载（扫描按帧合并，避免跟着整个应用的每次改动跑）；面板被移除时把手一并清掉。

## 安装

```powershell
& "<DSH安装目录>\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add "<插件目录绝对路径>"
```

然后重启 DSH Desktop。

## 测试

```powershell
node test/resize.test.mjs
```

测试台给 `getBoundingClientRect`、`style`、`pointerdown/move/up` 做了最小实现，把真实构建产物跑起来，逐条断言**尺寸算术**：四条边各自只影响自己的轴、东南拖拽不动左上角、北西拖拽同时移动原点、最小尺寸下限、上限随视口与固定边变化、撞到下限时固定边不移动、移动被视口夹住、双击重置、重开恢复、卸载清理。

顶栏下边界单独覆盖：没有顶栏时移动把手仍到 12px 边距、有 40px 顶栏时停在 40px、北向拖拽不能把面板顶回顶栏里、以及把一条停在顶栏内的旧记录在下次打开时拉回下方。

## 包结构

| 路径 | 作用 |
|---|---|
| `lib/client.js` | 浏览器半：全部逻辑都在这里，手写而非编译产物 |
| `lib/index.js` | 宿主半：空实现，只为让插件在 Loader 里占一行 |
| `cordis.patch.yml` | 组合包补丁，由 `package.json` 的 `dsh.bundle.patch` 指向 |
| `locale/*.json` | 插件列表里的显示文案（`meta.title` / `meta.description`） |
| `test/resize.test.mjs` | 离线测试台 |

`locale/` 有两个容易漏的约束：DSH 以 `locale/en.json` 为**锚点**，读不到它就不再读同目录下任何语言文件（所以英文那份必须存在）；文件名必须是语言 id（`en`、`zh`、`zh-CN`）。另外它要通过 Node 的 ESM 解析器取出，因此必须在 `package.json` 的 `exports` 里放行（`"./locale/*.json"`），并写进 `files` 才会进入发布包 —— 漏了不会报错，只是列表里退回英文描述。

## 边界

- 只碰设置模态框（`[role="dialog"][aria-modal="true"]` 且类名以 `_panel` 结尾）。其余弹窗不受影响。
- 面板自身的布局、功能、快捷键一律不变，只是多了可拖拽的边和顶栏。
- 尺寸存在浏览器 `localStorage`（键 `dsh-resizable-settings.v1`），按机器/浏览器各自独立。
- 如果 DSH 升级后改了设置面板的结构（不再是 `role="dialog"` + `_panel` 内联类名），把手会找不到面板、静默不生效 —— 不会报错，也不会破坏设置页。
