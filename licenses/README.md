# Hồ sơ giấy phép bên thứ ba

Đọc [mô tả phạm vi, nghĩa vụ và các điểm còn mở](../THIRD_PARTY_NOTICES.md) trước khi phân phối lại.

| File | Nội dung |
| --- | --- |
| [npm-inventory.json](npm-inventory.json) | 393 mục lockfile: phiên bản, giấy phép, nguồn tải, integrity và bằng chứng thông báo |
| [npm-notices.txt](npm-notices.txt) | Nguyên văn LICENSE/NOTICE và một số README có thông tin giấy phép; có tên gói, đường dẫn và SHA-256 |
| [container-inventory.json](container-inventory.json) | Digest image đã rà soát, 88 gói Debian, metadata npm và phiên bản native |
| [container-notices.txt](container-notices.txt) | Thông báo lấy từ filesystem image, gồm copyright Debian và common-licenses |
| [node-LICENSE.txt](node-LICENSE.txt) | Giấy phép Node.js 22.23.2 cùng thông báo thành phần nhúng từ upstream |
| [sharp-libvips-NOTICES.md](sharp-libvips-NOTICES.md) | Thông báo upstream tại commit của gói native Linux |
| [sharp-libvips-versions.properties](sharp-libvips-versions.properties) | Phiên bản native trong commit build upstream |
| [upstream-sources.json](upstream-sources.json) | URL upstream được ghim và SHA-256 của các văn bản bổ sung |

## Cách đối chiếu

Inventory npm dựa trên `package-lock.json`, không phải kết quả suy đoán từ tên thư viện. `dev`/`optional` phản ánh cờ npm, không xác định một gói có được bundle vào sản phẩm hay không. `evidence` cho biết văn bản lấy từ gói cài cục bộ cùng phiên bản, image release hoặc tarball registry đã kiểm tra integrity. Một số `noticeFiles` có `sourceUrl` vì tarball không chứa LICENSE và phải đọc từ commit upstream.

`lockfileSha256` nhận diện nội dung UTF-8 của lockfile sau khi chuẩn hóa xuống dòng CRLF thành LF, để kiểm tra nhất quán giữa Windows và Linux. `archiveSha256` và các digest OCI nhận diện bản TAR cũ đã kiểm tra; sửa tài liệu không làm thay đổi các binary đó. `copyrightResolvedPath` trong inventory Debian giải thích trường hợp dùng symlink thư mục. Các nhãn `licenseLabels` được trích từ Debian copyright, có thể là nhãn cục bộ và bao gồm các file không nằm trong binary; phải đọc nguyên văn copyright tương ứng.

Các văn bản upstream được giữ nguyên nội dung, chỉ thêm phần phân cách và thông tin nguồn trong hai file tổng hợp. Chúng giữ giấy phép của tác giả gốc, không được cấp lại theo MIT của dự án. Có thể có nhiều bản thông báo trùng nhau vì các gói/nền tảng khác nhau. Danh mục này không phải danh sách mã nguồn đầy đủ của mọi thành phần nhúng trong binary.
