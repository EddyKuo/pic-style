# **JavaScript 與 Electron 底片風格模擬引擎開發指南 (WebGL 實作)**

本指南將引導您使用 JavaScript、Electron 和 WebGL 開發一個專業級的底片風格模擬桌面應用程式。專案核心是建立一個模組化的渲染管線，用於精確模擬傳統底片的**色彩科學 (Color Science)**、**色調曲線 (Tone Curve)**、**顆粒感 (Film Grain)** 及 **光學瑕疵 (Optical Imperfections)**，並透過 **GPU 加速**實現對所有參數的即時調整與預覽。

考量到目前時間（**2025年8月26日**），Electron 和 WebGL 的生態系已高度成熟，是建構現代化、高效能桌面影像處理應用的理想選擇。

## **核心概念：解構類比美學**

此專案的核心是將數位影像透過一系列的物理模擬，重現底片在光化學反應下的獨特視覺特徵。我們將影像處理流程分解為幾個獨立但協同工作的模組：

1. **色彩與色調模組**：透過 3D LUT 和 S形色調曲線，重現特定底片（如 Kodak Portra, Fuji Velvia）的標誌性色彩與柔和的高光過渡。  
2. **顆粒模擬模組**：使用程序化雜訊（Procedural Noise）生成有機、不規律的底片顆粒，而非簡單的數位雜訊。  
3. **光學效果模組**：模擬如光暈 (Halation) 和暗角 (Vignette) 等物理光學現象，增添真實感與懷舊氛圍。

## **必要的開發工具與技術棧**

| 分類 | 工具 / 技術 | 用途說明 |
| :---- | :---- | :---- |
| **執行環境** | Node.js | Electron 的基礎，提供後端 API 和專案的執行環境。 |
| **應用程式框架** | Electron | **專案的骨架**。讓您能使用網頁技術建立桌面應用程式，並提供存取原生系統功能的 API（如檔案對話方塊）。 |
| **GPU 加速** | WebGL | **實現即時性能的關鍵**。我們將用它來執行所有密集的影像處理運算，如 LUT 應用、顆粒生成和多層混合。 |
| **GPU 程式語言** | GLSL | **在 GPU 上執行的演算法**。您需要編寫 GLSL 著色器來實作色調曲線、雜訊生成、光暈效果等。 |
| **UI 介面** | HTML / CSS | 負責應用程式的結構與外觀。 |
| **影像操作** | Canvas API | HTML5 的 \<canvas\> 元素是讀取影像像素、顯示 WebGL 內容以及將結果匯出的核心工具。 |
| **環境管理** | npm / yarn | Node.js 的套件管理器，用於安裝 Electron 和其他專案依賴。 |
| **開發環境** | Visual Studio Code | 推薦的程式碼編輯器，對 JavaScript 和 Electron 開發支援極佳。 |

**建立一個基本的 Electron 專案：**

\# 1\. 建立專案資料夾並初始化  
mkdir film-simulation-engine && cd film-simulation-engine  
npm init \-y

\# 2\. 安裝 Electron  
npm install \--save-dev electron

\# 3\. 在 package.json 的 "scripts" 中加入啟動指令  
\# "start": "electron ."

## **專案開發重點列項**

### **1\. 專案結構 (Electron Main vs. Renderer)**

* **主程序 (Main Process):** main.js。負責建立應用程式視窗、管理生命週期，並處理原生操作（如讀取 LUT 檔案、儲存影像、批次處理）。  
* **渲染程序 (Renderer Process):** index.html 及 renderer.js。這是應用程式的 UI 介面，所有參數控制、WebGL 渲染、使用者互動都在此進行。  
* **預載入腳本 (Preload Script):** preload.js。作為主程序和渲染程序之間安全的橋樑。

### **2\. UI 介面佈局 (index.html)**

UI佈局儘可能緊湊，不要保留太多空白，因為功能眾多。參數可以對應底片風格描述檔，位於./pic-styles.json
設計一個直觀的介面，讓使用者可以輕鬆控制各種底片參數：

* 一個主要的 \<canvas id="gl-canvas"\> 作為 WebGL 的繪圖目標。  
* 一個 \<select id="film-profile-selector"\> 下拉式選單，用於載入預設的底片風格 (對應 film\_profiles.json)。  
* **參數控制面板 (Control Panel)**:  
  * **色彩與色調**:  
    * temperature-slider: 色溫  
    * tint-slider: 色調  
    * vibrance-slider: 自然飽和度  
  * **顆粒 (Grain)**:  
    * grain-intensity-slider: 顆粒強度  
    * grain-size-slider: 顆粒大小  
    * grain-roughness-slider: 顆粒粗糙度  
    * grain-mono-toggle: 單色顆粒開關  
  * **光暈 (Halation)**:  
    * halation-intensity-slider: 光暈強度  
    * halation-radius-slider: 光暈半徑  
    * halation-threshold-slider: 觸發光暈的亮度閾值  
  * **光學 (Optics)**:  
    * vignette-intensity-slider: 暗角強度  
* **檔案操作按鈕**: load-btn, save-btn, batch-btn。  
* 一個隱藏的 \<input type="file"\>。

### **3\. 檔案與資源載入流程**

1. **載入圖片**: 流程與膚質修飾專案相同，透過 FileReader 將圖片轉為 Image 物件，供 WebGL 使用。  
2. **載入底片風格檔**: 應用程式啟動時，使用 fetch API 讀取 film\_profiles.json。解析後，將風格名稱填入 \<select\> 選單。當使用者選擇一個風格時，程式會讀取對應的 engine\_parameters 並更新所有 UI 滑桿和 WebGL uniforms。  
3. **載入 3D LUT**: 當一個風格被選中時，其 lut\_3d 參數（如 portra\_400.cube）會被讀取。你需要編寫一個解析器來讀取 .cube 檔案的內容，並將其轉換為 WebGL 可以使用的 3D 紋理 (gl.TEXTURE\_3D)。\*.CUBE檔放在專案資料夾裡的./cubes/裡。

### **4\. 核心演算法 (WebGL)**

這是專案的技術核心，透過幀緩衝區 (FBO) 實現一個多通道渲染管線。

* **A. 初始化 WebGL**: 取得 WebGL 上下文，並啟用 OES\_texture\_float 和 WEBGL\_color\_buffer\_float 擴展以支援高精度渲染。  
* **B. 編譯 GLSL Shaders**:  
  1. **色彩校正 (Color Shader)**: 接收原始影像紋理和 3D LUT 紋理。在 Shader 中對原始影像的顏色進行查表，並應用色溫、色調、色調曲線等調整。  
  2. **顆粒生成 (Grain Shader)**: 使用一個高效的雜訊函數（如 Simplex Noise）生成程序化顆粒圖層。  
  3. **光暈生成 (Halation Shader)**: 提取影像的高光部分，對其進行多次高斯模糊，然後染上紅色調。  
  4. **最終合成 (Composite Shader)**: 這是最後一步。它接收**色彩校正後的影像**、**顆粒圖層**和**光暈圖層**作為輸入。它會將這些圖層以適當的混合模式（如 Overlay 用於顆粒）疊加在一起，並在最後應用暗角效果。  
* **C. 上傳資源到 GPU**:  
  * 將 Image 物件上傳為 2D 紋理 (gl.TEXTURE\_2D)。  
  * 將解析後的 .cube 檔案數據上傳為 3D 紋理 (gl.TEXTURE\_3D)。  
* **D. 渲染管線 (Pipeline):**  
  1. **Pass 1 (色彩與色調):** 啟用 FBO 1。執行 **Color Shader**，將原始影像和 3D LUT 作為輸入，結果（色彩校正後的影像）渲染到 FBO 1 的紋理上。  
  2. **Pass 2 (光暈):** 啟用 FBO 2。執行 **Halation Shader**，將 **FBO 1 的結果**作為輸入，生成的光暈效果渲染到 FBO 2 的紋理上。  
  3. **Pass 3 (最終合成與輸出):** 解除綁定 FBO（渲染到主畫布）。執行 **Composite Shader**。它需要兩個紋理輸入：FBO 1 的色彩校正影像和 FBO 2 的光暈圖層。Shader 內部會即時生成顆粒，並將所有元素混合，最後輸出到畫面上。

### **5\. UI 互動性**

* 監聽所有滑桿的 input 事件和下拉式選單的 change 事件。  
* 當事件觸發時，獲取新值，並透過 gl.uniform 將其傳遞給對應的 Shader。  
* 立即重新執行一次完整的渲染管線 (Pass 1 \-\> 3)。由於所有計算都在 GPU 上，使用者能看到流暢的即時預覽效果。

### **6\. 檔案儲存 (Electron 原生整合)**

檔案儲存的邏輯與膚質修飾專案完全相同：

1. 在 renderer.js 中，將最終渲染結果從 WebGL 畫布繪製到一個 2D canvas。  
2. 使用 toDataURL 獲取 Base64 字串。  
3. 透過 ipcRenderer 將 Base64 字串傳送給主程序。  
4. 在 main.js 中，使用 dialog.showSaveDialog 讓使用者選擇路徑，然後將 Base64 數據轉換為 Buffer 並使用 fs.writeFile 儲存為 PNG 檔案。

### **7\. 批次處理 (Batch Processing)**

批次處理的實現方式也與膚質修飾專案類似，是提升效率的關鍵功能：

1. 主程序開啟一個可複選檔案的對話方塊。  
2. 渲染程序接收檔案列表，並在背景為每張圖片執行離屏渲染管線。  
3. 每處理完一張圖片，就將結果的 Base64 字串傳送給主程序進行儲存。  
4. 主程序會自動產生帶有 \_film 後綴的新檔名 (例如 photo.jpg \-\> photo\_film.png) 並儲存。  
5. UI 上的進度條和日誌會即時更新，提供處理進度的回饋。

