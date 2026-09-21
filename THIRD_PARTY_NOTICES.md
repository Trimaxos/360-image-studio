# Giấy phép và thông báo của bên thứ ba

Ngày rà soát: **21/09/2026**. Mã nguồn được đối chiếu trên `main`, commit `6b51075`; danh mục npm dựa trên các phiên bản khóa trong `package-lock.json`. Báo cáo mô tả giấy phép và bằng chứng đã kiểm tra, không xác nhận mọi bản nhị phân đã đáp ứng đầy đủ nghĩa vụ phân phối.

## 1. Phạm vi MIT của dự án

Mã nguồn và tài liệu thuộc quyền sở hữu của **Trimaxos và các tác giả đóng góp** được cấp phép theo [MIT](LICENSE). Người nhận được sử dụng, sao chép, sửa đổi, phân phối, cấp phép lại và bán bản sao, với điều kiện giữ thông báo bản quyền và nội dung giấy phép. Phần mềm được cung cấp không kèm bảo hành theo điều khoản MIT.

MIT không đổi giấy phép của thư viện, mã được sao chép từ bên thứ ba, tài sản không thuộc dự án, thành phần hệ điều hành, trọng số mô hình hoặc dịch vụ bên ngoài. Thông báo của tác giả gốc vẫn có hiệu lực. Metadata `ISC` ở các commit/bản đóng gói cũ không được sửa ngược bằng thay đổi này; file `LICENSE` và metadata MIT áp dụng cho phiên bản mã nguồn cập nhật này.

## 2. Kết quả rà soát npm

Đã rà soát **393 mục theo đường dẫn trong lockfile**, gồm phụ thuộc trực tiếp, gián tiếp, công cụ build/test và các biến thể tùy chọn theo nền tảng. Đây không phải 393 thư viện độc lập hoặc 393 gói đều có mặt trong bản chạy Linux.

| Giấy phép khai báo/đã xác minh | Số mục |
| --- | ---: |
| MIT | 271 |
| Apache-2.0 | 47 |
| ISC | 32 |
| MPL-2.0 | 12 |
| LGPL-3.0-or-later | 10 |
| BSD-2-Clause | 8 |
| BSD-3-Clause | 7 |
| Apache-2.0 AND LGPL-3.0-or-later | 3 |
| Apache-2.0 AND LGPL-3.0-or-later AND MIT | 1 |
| BlueOak-1.0.0 | 1 |
| 0BSD | 1 |

`busboy` và `streamsearch` thiếu trường `license` trong lockfile nhưng có LICENSE MIT trong gói; danh mục ghi riêng giá trị khai báo và kết quả xác minh. Không có mục npm khai báo GPL-only hoặc AGPL trong lockfile này. Kết quả đó không bao phủ giấy phép của mọi đoạn mã nhúng trong binary hoặc các gói Debian.

Các thư viện và công cụ đáng chú ý:

| Thành phần | Vai trò | Giấy phép |
| --- | --- | --- |
| React, React DOM, Zustand | Giao diện và trạng thái | MIT |
| Photo Sphere Viewer, Three.js, Fabric.js | Xem panorama và chỉnh sửa canvas | MIT |
| Express, CORS, Multer | HTTP và upload | MIT |
| adm-zip, Archiver | Đóng gói dữ liệu | MIT |
| dotenv | Đọc cấu hình môi trường | BSD-2-Clause |
| Sharp | Xử lý ảnh | Apache-2.0; native dependencies có điều khoản riêng |
| Vite, Rolldown, esbuild, tsx, jsdom | Build, chạy TypeScript và kiểm thử | MIT ở cấp gói; giữ cả thông báo thành phần nhúng |
| TypeScript | Công cụ ngôn ngữ | Apache-2.0 |
| Lightning CSS và các binding | Công cụ xử lý CSS gián tiếp | MPL-2.0 |

Một số thư viện giao diện nằm trong `devDependencies` nhưng được bundle vào JavaScript gửi tới người dùng. Không được bỏ thông báo của chúng chỉ vì cờ `dev` trong npm. Ngược lại, việc dùng compiler/bundler không tự động áp giấy phép compiler lên toàn bộ kết quả build; mã runtime/helper được đưa vào output vẫn cần xét riêng.

Danh sách **từng đường dẫn, phiên bản, URL tarball, integrity, repository và file thông báo** nằm trong [npm-inventory.json](licenses/npm-inventory.json). Nguyên văn giấy phép/NOTICE thu thập được nằm trong [npm-notices.txt](licenses/npm-notices.txt). Các gói tải thêm chỉ được đọc và kiểm tra integrity; không chạy lifecycle/install script.

## 3. Sharp, libvips và các thư viện native

Gói Linux được kiểm tra chứa libvips **8.18.3**, qua `@img/sharp-libvips-*` **1.3.2**. Biểu thức giấy phép của gói binary không thay cho giấy phép từng thư viện được liên kết.

[Thông báo upstream đã lưu](licenses/sharp-libvips-NOTICES.md) được lấy tại commit `4da6d14c0d59866adfb9d8cf52bcaa53846dc4f6` của `lovell/sharp-libvips`, theo `gitHead` của gói npm. [Bảng phiên bản upstream](licenses/sharp-libvips-versions.properties) khớp 28 thành phần trong `versions.json` của binary Linux glibc đã kiểm tra. Bản musl và WASM được ghi riêng trong [container-inventory.json](licenses/container-inventory.json); không dùng phiên bản Windows hoặc nhánh upstream mới nhất để suy ra phiên bản Linux.

- **LGPLv3:** libvips, libexif, libheif, librsvg, GLib, FriBidi, Pango và proxy-libintl theo lựa chọn phiên bản trong thông báo upstream.
- **MPL-2.0:** Cairo trong bản upstream được ghim này.
- **MIT/BSD và giấy phép riêng:** libarchive, libffi, HarfBuzz, lcms, pixman, libxml2, libwebp, cgif, Expat, Highway, fontconfig, FreeType, libpng, libtiff, zlib-ng và libultrahdr.
- **AOM:** BSD-2-Clause cùng điều khoản bằng sáng chế AOM.
- **mozjpeg:** nhiều điều khoản, gồm IJG, BSD và zlib.
- **libimagequant:** bản fork được upstream nêu là BSD-2-Clause; không suy giấy phép từ một bản libimagequant khác chỉ dựa vào tên.
- **WASM:** danh mục còn ghi `resvg` và Emscripten. Bảng libvips ở trên không phải bảng đầy đủ cho mọi thành phần của toolchain WASM.

Ứng dụng có thể giữ MIT khi sử dụng thư viện LGPL đúng điều kiện. Khi phân phối binary LGPL cần giữ thông báo và bản giấy phép, cung cấp mã nguồn tương ứng theo phương thức được giấy phép cho phép, và bảo đảm quyền sửa/thay thư viện. Với combined work, xem các lựa chọn liên kết lại hoặc shared-library mechanism ở LGPLv3 §4; không cấm reverse engineering nhằm gỡ lỗi sửa đổi của thư viện. Trường hợp static/WASM cần đánh giá riêng khả năng liên kết lại. Chỉ dẫn tới trang chủ upstream không tự nó chứng minh đã cung cấp đủ corresponding source.

## 4. Docker image và phần mềm hệ thống

Đã đọc các layer theo thứ tự manifest OCI của `360-image-studio.tar` trong bộ cài ZIP tại [release Ver0.1](https://github.com/Trimaxos/360-image-studio/releases/tag/Ver0.1), kiểm tra metadata gói và các file thông báo. Bản được rà soát là **Linux amd64**. SHA-256 của ZIP/TAR, digest manifest/config, danh sách layer, phiên bản native và metadata gói nằm trong [container-inventory.json](licenses/container-inventory.json). Binary được phân phối qua release assets; repository giữ mã nguồn, cấu hình và hồ sơ giấy phép.

- **88 gói Debian** được ghi nhận từ `/var/lib/dpkg/status`; có GPL, LGPL, BSD và các điều khoản khác. Các nhãn lấy từ file copyright là thông tin cấp file/đoạn mã, không phải một biểu thức SPDX tổng hợp cho toàn gói.
- **340 package.json có tên/phiên bản** được tìm thấy trong các cây `node_modules`, bao gồm phụ thuộc ứng dụng và công cụ npm/Corepack. Số này có thể gồm metadata lồng nhau; không cộng trực tiếp với 393 mục lockfile.
- **Node.js 22.23.2** có MIT và nhiều thông báo thành phần nhúng: [node-LICENSE.txt](licenses/node-LICENSE.txt).
- **npm 10.9.8** khai báo **Artistic-2.0**; **Corepack 0.34.6** khai báo MIT. Các thông báo được giữ trong [container-notices.txt](licenses/container-notices.txt).
- Các file copyright của Debian và văn bản ở `/usr/share/common-licenses` đã được sao lưu trong cùng tập thông báo. `libgcc-s1` và `libstdc++6` dùng symlink thư mục tới `gcc-12-base`; chúng không thiếu copyright. GCC runtime có các ngoại lệ riêng, không được bỏ qua khi đọc giấy phép GPL.

Phân phối các chương trình độc lập trong cùng image không tự động đổi giấy phép ứng dụng thành GPL. Tuy vậy, bên phân phối image vẫn phải đáp ứng nghĩa vụ của các chương trình GPL/LGPL thực sự được gửi đi, kể cả khi ứng dụng không gọi chúng. Xem [hướng dẫn Debian về phân phối](https://www.debian.org/doc/manuals/debian-faq/redistributing.en.html) và [GNU về aggregate](https://www.gnu.org/licenses/gpl-faq.html#MereAggregation).

## 5. Dịch vụ AI, mô hình và nội dung

fal.ai, DeepSeek và OpenCode là dịch vụ ngoài; MIT của ứng dụng không cấp quyền sử dụng miễn phí API, không thay điều khoản tài khoản, điều khoản từng model hay quyền đối với ảnh đầu vào/đầu ra. Người triển khai cung cấp khóa riêng và tuân thủ điều khoản tại thời điểm sử dụng; xem [điều khoản fal.ai](https://fal.ai/legal/terms-of-service).

Bản mã nguồn hiện tại gọi dịch vụ AI qua API. Giấy phép MIT này không cấp lại quyền đối với trọng số mô hình, ảnh người dùng, nhãn hiệu hoặc hình ảnh của bên thứ ba. Nguồn gốc và quyền của hình ảnh mockup/screenshot chưa được xác minh độc lập trong lần rà soát thư viện này; cần kiểm tra trước khi tái sử dụng chúng trong sản phẩm hoặc tài liệu quảng bá.

## 6. Phân phối bản đóng gói

Khi tạo bản release mới:

Đưa image và bộ cài vào **Assets** của [GitHub Releases](https://github.com/Trimaxos/360-image-studio/releases), không commit ZIP/TAR vào Git. Thay đổi nơi lưu không miễn trừ nghĩa vụ giấy phép: tải binary qua Releases vẫn là phân phối. Những bản binary đã có ở các commit cũ vẫn tồn tại trong lịch sử Git; việc bỏ theo dõi ở cây mã nguồn hiện tại không viết lại lịch sử.

1. Kèm `LICENSE`, `THIRD_PARTY_NOTICES.md` và thư mục `licenses/` với mã nguồn, gói ZIP và image. Giữ nguyên thông báo bản quyền trong các package và bản bundle frontend; cung cấp cách truy cập thông báo khi chỉ phát hành giao diện đã build.
2. Với MIT/ISC/BSD, giữ các điều khoản và tên chủ sở hữu theo từng văn bản. Với Apache-2.0, kèm giấy phép, giữ NOTICE nếu có, và đánh dấu file upstream đã sửa theo yêu cầu. Không dùng tên tác giả để ngụ ý bảo chứng trái với điều khoản.
3. Với MPL, cung cấp phần mã nguồn được MPL điều chỉnh và cách lấy mã nguồn đúng phiên bản, kể cả phần đã sửa khi có phân phối. Không cần đổi mã nguồn độc lập của dự án sang MPL.
4. Với GPL/LGPL trong image, chuẩn bị corresponding source phù hợp phiên bản đã phát hành, gồm bản vá và script build cần thiết, cùng cơ chế cung cấp đáp ứng đúng phiên bản giấy phép. Một URL chung hoặc tarball chỉ có binary không thay thế việc này. Đối chiếu gói nguồn Debian theo trường `Source`/`Version`; đối chiếu native libraries theo bảng phiên bản và commit build upstream.
5. Kiểm tra riêng binary native/static/WASM, các điều khoản bằng sáng chế và ngoại lệ. Việc file `package.json` ghi MIT/Apache không đủ để kết luận mọi mã nhúng đều mang cùng giấy phép.
6. Tạo lại inventory/notices khi dependency, nền tảng hoặc image thay đổi; cập nhật checksum sau khi đóng gói. Không gắn kết quả của image cũ cho image mới chỉ vì cùng tag `latest`.

**Trạng thái bản ZIP/TAR hiện có:** đã được kiểm tra nhưng chưa build/đóng gói lại trong thay đổi tài liệu này. Các file giấy phép mới ở repository chưa tự xuất hiện bên trong các archive cũ. Bộ notices là bằng chứng và nội dung giấy phép thu thập được, không phải một gói corresponding source hoàn chỉnh.

**Các điểm còn mở, cần xử lý trước khi tuyên bố bản binary tuân thủ đầy đủ:**

- `@tybys/wasm-util@0.10.3` và `tr46@0.0.3` khai báo MIT nhưng không có file giấy phép riêng trong tarball và cây nguồn tại `gitHead` đã kiểm tra. Metadata được ghi nhận; chưa có nguyên văn notice gắn với đúng bản này để sao lưu. Không tự chế thông báo bản quyền cho tác giả.
- Native libraries, mã nhúng của các binding và biến thể WASM chưa được đối chiếu tới từng file nguồn/copyright; cần hoàn thiện bản thông báo và source bundle tương ứng trước khi phân phối binary đó.
- Chưa có gói corresponding source kèm archive cho các thành phần GPL/LGPL của Debian và native libraries. Các inventory ghi rõ phiên bản để chuẩn bị gói nguồn; chúng không phải cam kết cung cấp nguồn bằng văn bản.
- Chưa đối chiếu nguồn gốc quyền của mọi tài sản hình ảnh trong repository.

## 7. Văn bản tham chiếu

Các bản đầy đủ theo từng gói đã thu thập được nằm trong [thư mục licenses](licenses/README.md). Nếu mô tả tiếng Việt khác với điều khoản gốc, áp dụng văn bản giấy phép gốc của thành phần tương ứng.

- [MIT](https://opensource.org/license/mit)
- [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0)
- [MPL 2.0 và FAQ](https://www.mozilla.org/en-US/MPL/2.0/FAQ/)
- [GNU LGPLv3](https://www.gnu.org/licenses/lgpl-3.0.html), [GNU GPLv3](https://www.gnu.org/licenses/gpl-3.0.html)
- [Artistic License 2.0](https://opensource.org/license/artistic-2-0)
- [Sharp/libvips: repository build](https://github.com/lovell/sharp-libvips/tree/4da6d14c0d59866adfb9d8cf52bcaa53846dc4f6)
