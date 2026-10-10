# Hướng dẫn fix ảnh 360 bằng Playwright MCP (làm tay, không script)

Với mỗi ảnh panorama trong `assets/hdr/`: **(1) xóa chân máy ở nadir, (2) fix TẤT CẢ các cửa sổ / cửa ra vào** (cháy sáng, ám màu, ngoài trời nhợt), rồi lưu project.

Cách làm: điều khiển trực tiếp app bằng công cụ Playwright MCP (click, gõ, kéo chuột, chụp màn hình). **Không viết script, không dùng `browser_evaluate` / `browser_run_code_unsafe`, không dựng lại automation.** Phạm vi sửa chỉ gồm chân máy + cửa; **không** chỉnh màu cả phòng.

> **Quy tắc cửa:** mỗi ảnh có bao nhiêu cửa thì fix hết bấy nhiêu. Không tự đánh giá "cửa này ổn" rồi bỏ qua; chỉ bỏ cửa khi PM nói.

## 0. Chuẩn bị (mỗi phiên)

- App chạy ở `http://localhost:3001` (không còn đăng nhập). **Mở bằng `http://localhost:3001/?auto=1`**: menu File có thêm mục lưu tự động (Bước 5); không có `?auto=1` thì menu là bản dành cho người dùng tay. Vừa sửa giao diện thì `npm run build`; vừa sửa server thì dừng cây tiến trình đang nghe cổng 3001 rồi chạy lại `npm run server`.
- 9router chạy ở cổng 20128. Model dùng: **GPT-6 Astra (Codex qua 9router — hạn mức ChatGPT)**, không tốn tiền fal. Các model fal tính tiền, chỉ dùng khi PM đồng ý.
- Trình duyệt Playwright **hiện cửa sổ** (Chrome thật, profile riêng), trang cỡ **1600×900**. Không đổi cỡ cửa sổ hay zoom trang giữa chừng.
- Ảnh gốc: `D:\projects\360-image-studio\assets\hdr\<tên>_hdr.jpg` (10000×5000). 360 View và Flat View hiện **thẳng ảnh gốc** (không qua bản thu nhỏ); layer crop cắt từ ảnh gốc và ghép ngược về ảnh gốc ở độ phân giải gốc.
- **Không tải / xuất file bằng trình duyệt** (`Download Project`, `Download Image`, `Export Final`…): Playwright MCP đang dùng làm Chrome **sập** mỗi lần có file tải về (lịch sử Downloads ghi `Failed - Crash`, mất cả phiên làm việc chưa lưu). PM tự xuất ở cuối.

## 1. Quy trình cho mỗi ảnh (mục tiêu: xác định xong vị trí các cửa trong dưới 1 phút)

### Bước 1 — Mở ảnh và chọn model
1. Màn hình trống: bấm vùng "Kéo thả ảnh…" (`label.image-drop-zone`); đang có ảnh: `☰ File` → `📂 Open Image`. Hộp chọn file hiện ra → `browser_file_upload` với đường dẫn tuyệt đối.
2. Chọn model: `browser_select_option` vào `select[aria-label="Model"]`, giá trị `ninerouter:cx/gpt-6-astra` (chọn lại sau mỗi lần trình duyệt khởi động lại).

### Bước 2 — Lập bản đồ khung cửa trên Flat View
Flat View chính là bản đồ: ảnh gốc trải phẳng, có lưới yaw/pitch (đường mỗi 10°, đậm và có nhãn số mỗi 30°).
1. Bấm tab **`Khung cửa`** ở bảng phải (`.panel-tabs button:has-text("Khung cửa")`), rồi nút **`Flat View`** ở thanh trên (`button:has-text("Flat View")`).
2. **Chụp màn hình một lần** (`browser_take_screenshot`) và tìm mọi cửa: cửa sổ, cửa kính trượt, cửa ra vào. Gương phản chiếu cửa không phải cửa. Đọc yaw/pitch của mỗi cửa theo lưới (sai số 1–2° là được). Chỗ nhỏ khó thấy thì cuộn chuột phóng Flat View (lưới phóng theo), xong cuộn về như cũ.
3. **Gõ các khung** vào ô `textarea[aria-label^="Khung cửa"]`, mỗi dòng một khung, rồi bấm `Thêm` (`button:text-is("Thêm")`):
   ```text
   <Tên>: yaw <từ>..<đến>, pitch <từ>..<đến>
   ```
   - Số âm và số thập phân đều được; tên bỏ trống thì app đặt "Cửa N". Khoảng ghi ngược (`yaw 20..10`) tự đổi chỗ.
   - **Ghi khung rộng hơn cửa cho thoải mái**: app tự thêm lề mỗi cạnh `max(35% cạnh, 4°)` và nâng cửa nhỏ lên tối thiểu 28°×21° để tile không bé.
   - **Cửa vắt qua mép trái/phải ảnh**: yaw được vượt ±180, ví dụ `Cửa mép: yaw 176..186, pitch -4..10` (vẫn ra **một** crop, vẽ thành hai hình chữ nhật trên Flat View).
   - **Gom cụm**: các cửa nằm cạnh nhau (kể cả cửa nhỏ ở xa) gộp thành một khung → một crop, một lượt Generate.
   - Dòng sai được báo đúng số dòng và **giữ lại trong ô** để sửa; các dòng đúng vẫn được thêm.
   - Đổi từ pixel ảnh phẳng (rộng W, cao H): `yaw = x/W×360 − 180` · `pitch = 90 − y/H×180`.
4. **Chụp lại Flat View**: các khung xanh phải phủ hết cửa (khung sát mép phải vẫn hiện đủ). Thiếu cửa thì gõ thêm một dòng. Khung cảnh báo (⚠ sát trần/sàn, FOV quá rộng, tile quá lớn) hiện trong danh sách dưới ô nhập.
5. Muốn đánh dấu bằng chuột: tick `Đánh dấu bằng chuột`, kéo một khung trên Flat View (một lần kéo = một khung; kéo ngắn hơn 6 px bị bỏ). Khi đang tick, Flat View tạm khóa phóng/kéo ảnh và ẩn `Edit Here`.

### Bước 3 — Tạo layer crop hàng loạt (chân máy + mọi cửa)
1. Bấm **`Tạo layer crop`** (`button.marks-create`). Chân máy tự thêm ở lần chạy đầu (ô `Thêm chân máy` tự bỏ tick khi ảnh đã có layer "Chân máy", nên chạy bổ sung không tạo chân máy thừa). Nút hiện tiến độ `Đang tạo n/N…` (server dựng mỗi tile vài giây, lần lượt từng crop; thử thật: 8 crop xong trong ≤ 20 s). Tiến độ nằm trong app: chuyển tab giữa chừng rồi quay lại vẫn thấy `Đang tạo…` và nút bị khóa, không bấm trùng được.
2. Xong hết thì app tự chuyển sang tab `Layers`: mỗi khung thành một **layer nháp** mang tên khung. Khung không đặt tên được gọi `Cửa N` nối tiếp số lớn nhất đang có (tính cả layer đã tạo), nên khung bổ sung ở lượt sau không trùng tên.
3. **Có crop lỗi thì app ở lại tab `Khung cửa`** và hiện lý do dưới nút (`Tên: lỗi`, selector `.marks-errors`). Khung lỗi vẫn nằm trong danh sách; bấm `Tạo layer crop` lại để làm riêng các khung đó.
4. Mỗi layer là crop đã tính sẵn đúng như `Apply Rect` (cùng góc nhìn, cùng khung kéo, ảnh gốc 1:1), prompt điền sẵn theo loại (mục 3). **Không phải xoay, chọn tỉ lệ, kéo khung hay Apply Rect.**
   - Cửa: góc nhìn vào giữa khung, FOV nhỏ nhất vẫn chứa khung + lề; crop luôn là một trong 11 tỉ lệ chuẩn của `Edit Here` (1:1, 2:3, 3:2, 4:3, 3:4, 16:9, 9:16, 1:2, 2:1, 1:3, 3:1), chọn cỡ nhỏ nhất vẫn phủ hết khung. Tỉ lệ tự do dễ làm model trả ảnh sai tỉ lệ ("Model trả ảnh sai tỉ lệ").
   - Chân máy: Pitch −90, FOV 90, ô vuông 330 px giữa màn hình (tile ≈ 1084 px, gần độ phân giải model nên sàn không bị mờ).

### Bước 4 — Gen hàng loạt, rồi xử lý từng layer (cùng một công thức cho chân máy và cửa)

AI chạy **nền theo từng layer**: tối đa 4 layer cùng lúc, layer thứ 5 trở đi tự xếp hàng. Vì vậy đừng đứng chờ từng layer: gửi hết trước, xử lý dần sau.

**4a. Gửi gen cho mọi layer** (chân máy + các cửa), mỗi layer ba thao tác:
1. `.layer-item:has-text("<Tên>") button[title="Edit"]` (nút `✎` trong tab `Layers`).
2. `button.prompt-btn-generate` (prompt đã điền sẵn, đổi nếu cần, xem mục 3). Nút đổi thành `Generating…`.
3. `button:has-text("Back to View")`: **không hỏi gì**, không đổi 360 View, không dừng việc AI đang chạy.

Trên dòng layer (tab `Layers`) có chip trạng thái: `⏳ đang gen` (đang chạy), `⏳ đang chờ lượt` (xếp hàng), `n kết quả` (xong), `⚠ lỗi` (rê chuột để xem lý do; bấm `Generate` lại để chạy lại). Mở lại layer đang chạy thì thấy `Generating…` (chưa bấm được); mở layer đã xong thì thấy các thẻ kết quả. Chờ bằng `browser_wait_for` `time: 30`, rồi `browser_find` regex `\d+ kết quả|⚠ lỗi|⏳`.

Thử thật trên Greens 2 (5 layer): gửi xong 5 layer sau ~1 phút (mỗi lần bấm Generate mất 5–6 s để dựng tile), **đủ 5 kết quả sau ~3 phút** kể từ lần Generate đầu; mỗi layer chạy 100–140 s khi 4 layer chạy cùng lúc. Làm lần lượt từng layer (gen xong mới sang layer sau) sẽ mất gấp hơn đôi.

**4b. Xử lý từng layer đã có kết quả**
1. `✎` mở layer: kết quả mới nhất đang được xem (thẻ `✓ ĐANG XEM`). **Bấm một thẻ chỉ là xem trong khung edit**: không đổi 360 View, Flat View, ảnh xuất hay project. Thẻ đang hiện ngoài 360 View có nhãn `🌐 Đang ở 360 View`.
2. `✎ Edit` trên thẻ kết quả → `Xóa toàn bộ` → `♻ Phục hồi` → cọ vùng cần lấy từ AI (mục 2), **vẽ rộng ra chỗ tường/trần quanh cửa bị loé hoặc ám màu**.
3. **Rà soát một lượt** (mục 2, bước 7).
4. `✓ Áp dụng chỉnh sửa` trong trình cọ = lưu mặt nạ **và đẩy ra 360 View**. Nút hiện `Đang áp…` (3–15 s, nadir lâu nhất) và nút `← Back to View` bị khóa trong lúc đó: chờ nút trở lại rồi mới Back (`browser_find` regex `Đang áp…`).
   - Muốn lấy nguyên kết quả AI không cọ: chọn thẻ rồi bấm `button.canvas-apply-btn` (`✓ Áp dụng ra 360`) ở thanh trên của khung edit. Chọn thẻ `Original` rồi bấm nút này là gỡ layer khỏi 360 View.
5. `← Back to View`. Back **không bao giờ** áp dụng hay bỏ gì: chưa bấm Áp dụng thì 360 View và project giữ nguyên. Layer đã áp dụng chuyển `draft` → `committed`.
6. Kiểm tra vị trí ở **360 View** (Yaw/Pitch/FOV nhập tay). Muốn xem mọi thay đổi trên bản đồ phẳng: tab `Flat View` → `button.flat-changes-btn` (`👁 Xem thay đổi`): hiện **một** ảnh gộp trong suốt của mọi layer đã áp dụng đúng chỗ (đo thật: 6 layer ~9 s lần đầu, 1 layer ~2 s, bật lại gần như tức thì vì server nhớ theo nội dung); bấm lại để về ảnh gốc. Flat View **không** vẽ từng layer, nên bản đồ luôn sạch.
7. Kết quả xấu (méo khung, đổi đồ đạc, lệch màu): `🗑` xóa kết quả, sửa prompt rồi `Generate` lại (cũng chạy nền như 4a).
8. Làm hết các layer trong danh sách. Riêng chân máy: sau khi xong, kiểm tra bằng FOV 30–50 nhìn lại nadir (Pitch −90); sàn phải khớp màu xung quanh.

### Bước 5 — Lưu tự động rồi sang ảnh kế tiếp
Xong hết layer (đang ở màn hình xem, không phải trong khung edit): `summary:has-text("File")` → `button:has-text("Auto: lưu vào assets/output/projects")` (chỉ có khi mở bằng `?auto=1`).
- Server ghi `<tên ảnh>.360project` vào `assets/output/projects`, **không bao giờ ghi đè**: trùng tên thì thêm ` (2)`, ` (3)`… Thư mục này đang có sẵn nhiều project cũ nên số có thể đã lớn; file có số lớn nhất là bản làm gần nhất.
- Thông báo `Đã lưu: <đường dẫn>` hiện ở cuối màn hình khoảng 8 s (`browser_find` regex `Đã lưu: [^"]*`); lỗi hiện ở hộp đỏ `Không lưu được: …`.
- Mỗi file ~50–90 MB (có cả ảnh gốc 23 MB): chỉ lưu khi chốt ảnh, đừng lưu thử nhiều lần. Menu File thường (`Save Project` mở hộp thoại Windows) giữ nguyên cho người dùng tay.
- Đã thấy `Đã lưu: …` thì mở ảnh kế tiếp (`☰ File` → `📂 Open Image`). PM xuất ảnh ở cuối.

## 2. Cọ ("Tinh chỉnh kết quả") — cách chọn vùng

Trình cọ mở ra với **toàn bộ kết quả AI đang hiện**. AI vẽ lại cả tile nên phải giới hạn đúng vùng cần sửa:

1. `Xóa toàn bộ` (ảnh gốc hiện ra hết), `◉ Hiện ảnh gốc` (bật để thấy kết quả ghép khi tô).
2. Công cụ `♻ Phục hồi`, rồi **tô lên đúng vùng muốn lấy từ AI**.
3. Cọ: `Độ mờ` 100%. `Kích thước` 300 (tối đa), `Vùng nét (vòng trong)` 30% cho nadir, 50% cho cửa. Đặt bằng `browser_fill_form` kiểu `slider` vào `.result-mask-sliders label:nth-of-type(1) input` (kích thước) và `label:nth-of-type(3) input` (vùng nét). Giá trị về mặc định mỗi lần mở lại trình cọ.
4. **Nét kéo thẳng bằng `browser_mouse_drag_xy`; vùng rộng thì kéo nhiều nét song song cách nhau ≤ đường kính lõi (đường kính vòng ngoài × vùng nét).** Cửa cao: kéo các nét dọc; nadir: vài nét ngang cách ~40 px. **Kích thước cọ tính theo pixel của tile, còn trình cọ thu tile lớn hơn ~604 px về 604 px**: tile 1084 px hiện ×0,56 (cọ 300 px thành vòng ~167 px, lõi 30% ~50 px), tile ≤ 800 px hiện nguyên cỡ (cọ 100 px = vòng 100 px). Tính khoảng cách nét theo cỡ vòng cọ **trên màn hình** (chụp một lần, đọc vòng cọ hiện theo con trỏ), đừng áp con số cố định từ tile khác.
5. Vùng giữ cho cửa = kính + khung + mảng tường/trần/sàn bị loé hoặc ám màu quanh cửa (vẽ rộng ra đúng chỗ đó cho hết). Không tô lên đồ đạc nếu không cần. Mép phải mượt, không quầng sáng; màu vùng sửa đồng màu với xung quanh.
6. `⌫ Xóa` để bỏ phần tô thừa (đặt cỡ nhỏ ~100 px, vùng nét 70%), `Ctrl+Z` hoàn tác. Cuộn chuột trong khung ảnh để xem phần dưới của tile khi đã phóng (`+` ở thanh zoom).
7. **Rà soát một lượt trước khi áp dụng.** Bấm `◉ Hiện ảnh gốc` (nút đổi thành `Ẩn ảnh gốc`) để thấy vùng AI đã tô ghép lên ảnh gốc, chụp màn hình rồi nhìn kỹ **viền vùng tô**: màu AI có lẹm sang vùng màu của ảnh gốc không (quầng sáng, viền lệch màu, khung cửa/đồ đạc bị đổi). Chưa bật thì canvas chỉ hiện vùng AI đã tô trên nền caro. Chỗ lẹm (hay gặp ở chỗ nét cuối của cọ chạm tường/sàn dưới cửa, vùng mờ của cọ lan ra ngoài khung) thì `⌫ Xóa` bớt; chỗ còn cháy/ám màu mà chưa tô tới thì `♻ Phục hồi` tô thêm. Ổn rồi mới `✓ Áp dụng chỉnh sửa` → chờ hết `Đang áp…` → `← Back to View`.

## 3. Prompt (tiếng Anh, ngắn, chỉ nói điều cần đổi)

App tự dịch tiếng Việt khi có khóa dịch; tiếng Anh đi thẳng, nên **viết tiếng Anh**. Hai dòng đầu bảng được `Tạo layer crop` điền sẵn vào từng layer; chỉ sửa khi cảnh cần nói thêm.

| Trường hợp | Prompt |
| --- | --- |
| Chân máy (điền sẵn) | `Remove the camera tripod from the center of the floor. Reconstruct the floor exactly as it continues around it, with the same material, color and lighting. Keep the texture sharp and detailed, matching the surrounding floor.` Có thể thêm mô tả sàn hai bên (`: <gạch, thảm…>`). |
| Cửa (điền sẵn — cháy sáng, ám màu, nhợt) | `Apply HDR processing to the outside view through every window: balanced exposure with recovered highlight and shadow detail, a natural blue sky and green foliage, and remove the glare, glow and colour cast around the window frames. Keep the room interior, curtains, pillars and furniture unchanged.` |
| Ngoài trời quá tối | `Brighten the outdoor view through the windows to natural daylight exposure and restore detail. Remove the dark tint around the frames. Keep the room interior unchanged.` |
| Cửa kính trượt / cửa ra vào | Như cửa mặc định, thêm `Keep the door frames, handles and furniture exactly as they are.` |

## 4. Lưu ý điều khiển Playwright MCP

- Dùng **selector CSS / Playwright** làm `target` (ref `eNN` đổi sau mỗi lần dựng lại): `select[aria-label="Model"]`, `input[placeholder="Nhập prompt..."]`, `button.prompt-btn-generate`, `button:has-text("Back to View")`, `button.canvas-apply-btn` (`✓ Áp dụng ra 360`), `button:has-text("Xóa toàn bộ")`, `button:text-is("♻ Phục hồi")`, `button:text-is("⌫ Xóa")`, `button:has-text("Hiện ảnh gốc")`, `button:has-text("Áp dụng chỉnh sửa")`, `button[aria-label="Phóng to"]` (zoom trong trình cọ), `summary:has-text("File")`, `button:has-text("Auto: lưu vào assets/output/projects")`.
- Bản đồ khung cửa: `.panel-tabs button:has-text("Khung cửa")`, `button:has-text("Flat View")`, `textarea[aria-label^="Khung cửa"]`, `button:text-is("Thêm")`, `button.marks-create`, `.marks-errors` (lỗi từng dòng / từng crop), `.marks-list li` (các khung đã thêm). Layer: `.layer-item:has-text("<Tên>") button[title="Edit"]`. Thẻ kết quả: `.variant-card:has-text("AI: cx/gpt-6-astra")` (bấm = xem) và nút trong thẻ `.variant-card:has-text("AI: cx/gpt-6-astra") button:has-text("Edit")`; thẻ ảnh gốc `.variant-card:has-text("Original")`. Công tắc Flat View: `button.flat-changes-btn`.
- Trạng thái nên đọc bằng `browser_find` (ít chữ hơn chụp màn hình): chip layer `⏳ đang gen|⏳ đang chờ lượt|\d+ kết quả|⚠ lỗi`; trong khung edit `Generating…`, `Đang áp…`, `Đã áp dụng ra 360 View.`; sau lưu `Đã lưu: [^"]*`.
- Ảnh chụp màn hình: công cụ chỉ ghi được vào thư mục dự án (`.playwright-mcp/`, đã bị git bỏ qua). Đặt tên rõ (`filename: ".playwright-mcp/<tên>.png"`) và xoá các file mình tạo sau khi xong ảnh; đừng để ảnh chụp rải ra thư mục gốc.
- **Khung kéo giờ do app tự tính** nên bước mặc định không còn phụ thuộc toạ độ màn hình. Chỉ khi làm tay một crop lẻ bằng `Edit Here` / `Apply Rect` mới dùng toạ độ (780,740) / (870,768) và phải giữ nguyên cỡ trình duyệt (vùng nhìn 360 là 1120×761 px, x 220–1340, y 48–809).
- Nhập góc nhìn tay: `browser_fill_form` vào `input[aria-label="Yaw value" | "Pitch value" | "FOV value"]` (Yaw −180..180, Pitch −90..90, FOV 10..120). Chỉ đổi được khi đang ở màn hình xem (không phải lúc chọn vùng / chỉnh sửa / chờ AI).
- Chờ tạo layer hoặc chờ AI: `browser_wait_for` với `time: 30` (chờ đủ 30 s), rồi kiểm tra bằng `browser_find` regex `Đang tạo|\d+ kết quả|⏳|⚠`. **Đừng** dùng `text`/`textGone` cho việc chờ lâu: chúng chỉ chờ 5 s. Trong lúc AI chạy nền, tranh thủ làm việc khác (xử lý layer đã xong, đọc ảnh kế…).
- Hộp thoại gốc (`confirm` khi xóa layer) cần `browser_handle_dialog`.
- Soi chi tiết một vùng nhỏ ở tab phụ (`browser_tabs` `new` rồi `select`): `http://localhost:3001/api/image/tile?path=<đường dẫn mã hóa>&x=…&y=…&w=…&h=…` (toạ độ px của ảnh gốc), rồi đổi sang góc nhìn bằng công thức ở Bước 2. Nếu trình duyệt sập, mọi tab mất; tab chính đang làm dở cũng mất.
- Đóng trình duyệt thì tắt luôn tiến trình, kiểm tra không còn tiến trình Chrome/Chromium của Playwright; chỉ dọn đúng cây tiến trình của mình.

## 5. Kiểm tra trước khi sang ảnh khác

- [ ] Chân máy hết, sàn khớp màu.
- [ ] **Mọi** cửa trong bản đồ ở Bước 2 đã có layer và đã xử lý: nhìn được cảnh ngoài trời, hết quầng sáng/ám màu quanh khung.
- [ ] Mỗi layer đã rà soát viền vùng tô trước khi áp dụng (không lẹm màu sang ảnh gốc) và đã `committed` (đã áp dụng ra 360).
- [ ] Không đổi thứ không liên quan (đồ đạc, khung cửa, đường nét thẳng).
- [ ] Ảnh đã được lưu theo Bước 5 (thấy `Đã lưu: …`, file có trong `assets/output/projects`).
