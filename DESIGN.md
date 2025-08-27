# 底片風格模擬器 - 設計文檔

## 專案概述

**底片風格模擬器 (Pic Style)** 是一個專業級的桌面應用程式，使用 Electron 和 WebGL 技術開發，專門用於將數位影像轉換為具有傳統底片風格的藝術作品。本應用程式透過 GPU 加速的即時渲染，精確模擬底片的色彩科學、光學特性和物理瑕疵。

### 核心理念
將數位攝影的便利性與傳統底片的美學特質相結合，讓現代攝影師能夠輕鬆創造出具有懷舊魅力和藝術感的影像作品。

---

## 技術架構

### 系統架構圖
```
┌─────────────────────┐    ┌──────────────────────┐    ┌─────────────────────┐
│    Electron Main    │◄──►│   Renderer Process   │◄──►│    WebGL Context    │
│    Process (主程序)  │    │   (渲染程序)          │    │    (GPU 加速)        │
└─────────────────────┘    └──────────────────────┘    └─────────────────────┘
         │                           │                           │
         ▼                           ▼                           ▼
┌─────────────────────┐    ┌──────────────────────┐    ┌─────────────────────┐
│   File System      │    │       UI Controls    │    │   Shader Programs   │
│   IPC Handlers      │    │       Event Loop     │    │   Texture Management│
│   Dialog Management │    │       Parameter Sync │    │   FBO Pipeline      │
└─────────────────────┘    └──────────────────────┘    └─────────────────────┘
```

### 技術棧

| 分類 | 技術 | 版本 | 用途 |
|------|------|------|------|
| **執行環境** | Node.js | 16+ | Electron 基礎環境 |
| **應用框架** | Electron | 37.3.1 | 跨平台桌面應用程式框架 |
| **圖形渲染** | WebGL | 1.0 | GPU 加速影像處理 |
| **着色器語言** | GLSL ES | 1.0 | 圖形着色器程式語言 |
| **UI 技術** | HTML5/CSS3 | - | 使用者介面 |
| **構建工具** | electron-builder | 26.0.12 | 應用程式打包和分發 |

---

## 渲染管線設計

### 多通道渲染架構

本應用程式採用**三通道渲染管線 (3-Pass Rendering Pipeline)**，每個通道負責特定的視覺效果處理：

```
原始影像 → Pass 1: 色彩校正 → Pass 2: 光暈生成 → Pass 3: 最終合成 → 輸出影像
```

#### Pass 1: 色彩校正通道 (`color.glsl`)
**功能**: 基礎色彩調整和 3D LUT 應用
- **輸入**: 原始影像紋理 + 3D LUT 紋理
- **處理**: 
  - 色溫調整 (Temperature Adjustment)
  - 色調調整 (Tint Adjustment) 
  - 自然飽和度增強 (Vibrance Enhancement)
  - 3D LUT 色彩映射
- **輸出**: 色彩校正後的影像 (存儲到 FBO1)

#### Pass 2: 光暈生成通道 (`halation.glsl`)
**功能**: 模擬底片的光暈效果 (Halation)
- **輸入**: Pass 1 的色彩校正影像
- **處理**:
  - 高光區域提取 (基於亮度閾值)
  - 9x9 高斯模糊核心
  - 紅色調色 (模擬底片的紅色光暈)
- **輸出**: 光暈效果圖層 (存儲到 FBO2)

#### Pass 3: 最終合成通道 (`composite.glsl`)
**功能**: 整合所有效果並生成最終影像
- **輸入**: 色彩校正影像 + 光暈圖層
- **處理**:
  - 程序化顆粒生成 (Procedural Grain)
  - 顆粒粗糙度控制
  - 光暈混合 (Screen Blend Mode)
  - 暗角效果 (Vignette)
- **輸出**: 最終的底片風格影像

### 幀緩衝物件 (FBO) 管理

```glsl
FBO1 (色彩通道) → 儲存色彩校正後的影像
FBO2 (光暈通道) → 儲存光暈效果圖層
主畫布 (Main Canvas) → 最終合成輸出
```

---

## 演算法詳細設計

### 1. 3D LUT 處理系統

#### LUT 檔案格式支援
- **格式**: Adobe .CUBE 格式
- **解析度**: 支援任意大小 (常見: 33x33x33, 65x65x65)
- **色彩空間**: RGB

#### 3D 到 2D 紋理轉換演算法

```javascript
function convertLutTo2D(data, size) {
    const slicesPerRow = Math.floor(Math.sqrt(size));
    const numRows = Math.ceil(size / slicesPerRow);
    const textureWidth = size * slicesPerRow;
    const textureHeight = size * numRows;
    
    // 將 3D LUT 資料重新排列為 2D 紋理
    // 每個 Z 切片水平排列，形成網格狀佈局
}
```

#### GLSL 中的 LUT 查表演算法

```glsl
vec3 applyLut(vec3 color) {
    // 計算 3D 座標在 2D 紋理中的位置
    float slice_z = color.b * (u_lut_size - 1.0);
    
    // 雙線性插值獲取精確色彩值
    // 在相鄰的兩個 Z 切片間進行混合
    return mix(sample_floor, sample_ceil, slice_z_mix);
}
```

### 2. 程序化顆粒生成

#### 雜訊函數
```glsl
float random(vec2 co) {
    return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
}
```

#### 顆粒特性控制
- **大小控制**: `u_grain_size` 參數調整雜訊採樣密度
- **粗糙度**: 使用 `pow()` 函數調整雜訊分佈曲線
- **色彩模式**: 支援單色和彩色顆粒

```glsl
// 粗糙度控制演算法
float roughened_noise = pow(base_noise, mix(1.0, 3.0, u_grain_roughness));
```

### 3. 光暈效果實現

#### 高光提取
```glsl
vec4 extract_bright(sampler2D tex, vec2 uv, float threshold) {
    vec4 color = texture2D(tex, uv);
    float brightness = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
    return color * smoothstep(threshold, threshold + 0.1, brightness);
}
```

#### 高斯模糊核心
- **核心大小**: 9x9 (可調整)
- **權重計算**: `exp(-(x*x + y*y) / 8.0)`
- **正規化**: 確保總權重為 1.0

---

## 資料結構設計

### 底片風格描述檔 (`pic-styles.json`)
```json
{
  "id": "film_name",
  "name": "顯示名稱", 
  "lut_3d": "LUT檔案名.CUBE",
  "engine_parameters": {
    "temperature": 0,      // 色溫 (-100 to 100)
    "tint": 0,            // 色調 (-100 to 100)  
    "vibrance": 0,        // 自然飽和度 (-100 to 100)
    "grainIntensity": 15, // 顆粒強度 (0 to 100)
    "grainSize": 1.2,     // 顆粒大小 (0.5 to 5)
    "grainRoughness": 0.5,// 顆粒粗糙度 (0 to 1)
    "grainMono": true,    // 單色顆粒開關
    "halationIntensity": 0.1,  // 光暈強度 (0 to 1)
    "halationRadius": 25,      // 光暈半徑 (0 to 100)
    "halationThreshold": 0.9,  // 光暈閾值 (0.5 to 1)
    "vignetteIntensity": 0.2   // 暗角強度 (0 to 1)
  }
}
```

### WebGL 資源管理
```javascript
// 全域資源物件
let gl;                    // WebGL 上下文
let programs = {};         // 着色器程式集合
let textures = {};         // 紋理物件集合
let fbos = {};            // 幀緩衝物件集合
let originalImage = {};    // 原始影像資訊
```

---

## 使用者介面設計

### 佈局架構
```
┌─────────────────┬──────────────────────────┐
│                 │                          │
│   控制面板       │        主預覽區域         │
│   (300px 寬)    │       (Canvas)           │
│                 │                          │
│   ┌───────────┐ │                          │
│   │ 底片風格  │ │                          │
│   ├───────────┤ │                          │
│   │色彩與色調 │ │       WebGL Canvas       │
│   ├───────────┤ │                          │
│   │  顆粒感   │ │                          │
│   ├───────────┤ │                          │
│   │ 光暈效果  │ │                          │
│   ├───────────┤ │                          │
│   │ 光學效果  │ │                          │
│   ├───────────┤ │                          │
│   │ 檔案操作  │ │                          │
│   └───────────┘ │                          │
└─────────────────┴──────────────────────────┘
```

### 控制項目規格

| 控制項 | 類型 | 範圍 | 預設值 | 說明 |
|--------|------|------|--------|------|
| 底片風格 | 下拉選單 | - | 第一個項目 | 載入預設參數組合 |
| 色溫 | 滑桿 | -100 to 100 | 0 | 暖調/冷調調整 |
| 色調 | 滑桿 | -100 to 100 | 0 | 洋紅/綠色平衡 |
| 自然飽和度 | 滑桿 | -100 to 100 | 0 | 智慧飽和度增強 |
| 顆粒強度 | 滑桿 | 0 to 100 | 20 | 顆粒可見度 |
| 顆粒大小 | 滑桿 | 0.5 to 5.0 | 1.5 | 顆粒尺寸 |
| 顆粒粗糙度 | 滑桿 | 0 to 1.0 | 0.5 | 顆粒不規則程度 |
| 單色顆粒 | 複選框 | On/Off | On | 彩色或單色顆粒 |
| 光暈強度 | 滑桿 | 0 to 1.0 | 0.1 | 光暈明顯程度 |
| 光暈半徑 | 滑桿 | 0 to 100 | 25 | 光暈擴散範圍 |
| 光暈閾值 | 滑桿 | 0.5 to 1.0 | 0.9 | 觸發光暈的亮度 |
| 暗角強度 | 滑桿 | 0 to 1.0 | 0.2 | 邊緣暗化程度 |

---

## 效能最佳化策略

### GPU 加速最佳化
1. **紋理快取**: 避免重複上傳紋理資料
2. **FBO 重用**: 動態調整 FBO 大小而非重建
3. **着色器編譯快取**: 預編譯所有着色器程式
4. **批次渲染**: 減少 GPU 狀態切換

### 記憶體管理
```javascript
// 智慧 FBO 大小調整
function resizeFBOs(width, height) {
    if (fbos.color) {
        gl.deleteFramebuffer(fbos.color.framebuffer);
        gl.deleteTexture(fbos.color.texture);
    }
    fbos.color = createFBO(width, height);
}
```

### 即時預覽最佳化
- **事件節流**: 避免滑桿拖曳時的過度渲染
- **差異化更新**: 只在參數改變時重新渲染
- **漸進式載入**: 大型 LUT 檔案的背景載入

---

## 檔案系統架構

### 專案結構
```
pic-style/
├── main.js              # Electron 主程序
├── preload.js           # 安全橋接腳本
├── renderer.js          # 渲染程序邏輯
├── index.html           # 使用者介面
├── package.json         # 專案配置
├── pic-styles.json      # 底片風格資料
├── shaders/            # GLSL 着色器檔案
│   ├── vertex.glsl     # 頂點着色器
│   ├── color.glsl      # 色彩校正着色器
│   ├── halation.glsl   # 光暈效果着色器
│   └── composite.glsl  # 最終合成着色器
├── cubes/              # 3D LUT 檔案目錄
│   ├── *.CUBE          # Adobe CUBE 格式 LUT 檔案
│   └── ...
└── dist/               # 建置輸出目錄
    └── Pic Style-1.0.0-portable.exe
```

### 資源載入策略

#### 開發環境 vs 生產環境
```javascript
// 開發模式：直接讀取檔案系統
if (isDev) {
    const response = await fetch(filePath);
    return response.text();
}

// 生產模式：從 app.asar 或 extraResources 讀取
const content = await window.electron.readExtraResource(relativePath);
return content;
```

---

## 安全性設計

### Content Security Policy (CSP)
```html
<meta http-equiv="Content-Security-Policy" 
      content="default-src 'none'; 
               script-src 'self' file:; 
               style-src 'self' 'unsafe-inline' file:; 
               img-src 'self' data: file:; 
               connect-src 'self' file:;">
```

### IPC 通信安全
- **Context Isolation**: 啟用上下文隔離
- **Node Integration**: 停用 Node.js 整合
- **Preload Script**: 使用預載入腳本作為安全橋樑

### 資料驗證
```javascript
// 輸入資料清理
const safeFiles = Array.isArray(files) ? files.map(f => String(f)) : [];
const safeSettings = settings && typeof settings === 'object' ? 
    JSON.parse(JSON.stringify(settings)) : {};
```

---

## 擴展性設計

### 模組化架構
每個功能模組都設計為獨立可替換的組件：

1. **LUT 處理模組**: 支援擴展其他 LUT 格式
2. **效果渲染模組**: 可插拔的效果着色器
3. **UI 控制模組**: 可動態配置的參數面板
4. **檔案處理模組**: 支援更多影像格式

### 着色器動態載入
```javascript
// 支援動態載入新效果着色器
async function loadCustomShader(shaderName) {
    const shaderSource = await loadExtraResource(`custom-shaders/${shaderName}.glsl`);
    return createShader(gl.FRAGMENT_SHADER, shaderSource);
}
```

### 外掛系統架構 (未來擴展)
```javascript
// 預留外掛介面
const PluginManager = {
    registerEffect(name, shaderCode, parameters) { /* ... */ },
    registerLUTFormat(extension, parser) { /* ... */ },
    registerUIControl(type, renderer) { /* ... */ }
};
```

---

## 測試策略

### 單元測試
- **LUT 解析器**: 驗證各種 CUBE 檔案格式
- **色彩轉換**: 確保數學運算精確性
- **參數驗證**: 檢查輸入範圍和類型

### 整合測試  
- **端對端工作流程**: 從載入到儲存的完整流程
- **跨平台相容性**: Windows/macOS/Linux 測試
- **效能基準測試**: 大尺寸影像處理效能

### 視覺回歸測試
- **基準影像比對**: 確保效果一致性
- **參數邊界測試**: 極值情況下的視覺輸出
- **LUT 準確性驗證**: 與標準軟體結果比對

---

## 版本控制策略

### 語義化版本控制
- **主版本 (Major)**: 不相容的 API 變更
- **次版本 (Minor)**: 向後相容的新功能
- **修訂版本 (Patch)**: 向後相容的問題修復

### 發布流程
1. **開發分支**: `develop` - 日常開發
2. **功能分支**: `feature/*` - 特定功能開發
3. **發布分支**: `release/*` - 版本準備
4. **主分支**: `main` - 穩定發布版本

---

## 效能指標

### 渲染效能目標
- **即時預覽**: < 16ms (60 FPS)
- **高解析影像處理**: 4K 影像 < 1 秒
- **記憶體使用**: < 512MB (不含影像緩存)
- **啟動時間**: < 3 秒

### 檔案處理效能
- **影像載入**: 支援 100MB+ 檔案
- **LUT 載入**: 65³ LUT < 100ms
- **批次處理**: 同時處理 50+ 檔案

---

## 未來發展方向

### 短期目標 (v1.1 - v1.3)
1. **額外效果**: 色彩分離、邊緣銳化
2. **更多 LUT 格式**: .3dl, .csp 支援
3. **匯出格式**: TIFF, JPEG 支援
4. **效能最佳化**: GPU 記憶體管理改善

### 中期目標 (v1.4 - v2.0)
1. **RAW 檔案支援**: 直接處理 RAW 格式
2. **批次自動化**: 腳本化批次處理
3. **自訂 LUT**: 內建 LUT 編輯器
4. **外掛系統**: 第三方效果外掛

### 長期目標 (v2.0+)
1. **雲端同步**: 設定和 LUT 雲端儲存
2. **AI 輔助**: 智慧底片風格建議
3. **協作功能**: 團隊共享和版本控制
4. **行動版本**: iOS/Android 配套應用

---

## 結語

底片風格模擬器的設計理念是將傳統底片的美學特質與現代數位技術完美融合，為攝影師和藝術創作者提供專業級的創作工具。透過精確的數學模型和先進的 GPU 加速技術，我們能夠忠實重現底片獨有的色彩科學和光學特性，同時保持現代軟體的便利性和效能。

這份設計文檔將作為開發團隊的指導原則，確保產品在技術實現、使用者體驗和未來擴展性方面都能達到最高標準。