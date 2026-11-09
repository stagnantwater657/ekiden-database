# GitHub Actions → 腾讯云 COS 上传测速

本轮只新增手动测速代码，未运行真实测速，未接触 Ubuntu 生产服务器，也不改动现有 deploy.yml、Docker 或网站部署流程。

## 资源与权限

- Bucket：`ekiden-deploy-test-1416877161`，Region：`ap-shanghai`。
- Bucket 保持**私有读写**；不修改 ACL、不公开对象、不生成永久公开链接。
- Repository Secrets：`COS_SECRET_ID`、`COS_SECRET_KEY`、`COS_BUCKET`。`COS_BUCKET` 必须为上述专用测试桶，脚本不接受其他桶。
- Key 固定为 `benchmarks/<GitHub Run ID>/test-10m.bin`，例如 `benchmarks/123456789/test-10m.bin`。IAM 子用户只需对该前缀的 `PutObject` 权限即可执行上传，不需要 ListBucket、建桶、改桶或 ACL 管理权限。后续下载签名账户需有该对象的 GetObject 权限，清理账户需有该对象的 DeleteObject 权限；不要扩大到 COS 全局权限。

官方 SDK 为腾讯云 `cos-python-sdk-v5==1.9.44`，HTTP 依赖固定为 `requests==2.34.2`。测试使用单次 `put_object`，不使用 SDK 高级分片上传或桶探测功能，也不执行自动 Get/Head/Delete。

## 1. 手动触发上传测速

1. 审核并合并 PR，让 GitHub 在默认分支识别工作流。
2. 确认仓库 Settings → Secrets and variables → Actions 中已有三个 Repository Secrets，不把值粘贴到日志、Issue 或命令中。
3. 打开 Actions → **COS upload speed test** → **Run workflow**，选择已审核的 `main`，手动启动。
4. 工作流仅有 `workflow_dispatch`，Runner 固定为 `ubuntu-22.04`，权限为 `contents: read`，job 总时限 **15 分钟**。push、PR 或合并都不会触发真实上传。

每次生成 **10 MiB = 10,485,760 字节**的密码学随机二进制文件，不压缩、不上传 Docker 镜像。随机文件生成、SHA-256 计算和 SDK 初始化在计时之前完成；计时从调用 PutObject 前开始，到成功响应或异常返回结束，包含 DNS、连接、TLS、签名、传输及响应开销。它是单个小对象的端到端上传速率，不能直接视为 115 MB 镜像的持续吞吐或完整部署速度。

重复运行同一个 Run ID 的 Re-run 会覆盖同一 Key（若桶开启版本控制则按其既有规则产生版本），请记录对应 Run attempt 和最新 SHA-256。不同 Run ID 使用不同 Key，互不覆盖。

## 2. 查看速度、哈希和状态

- 查看该次 Run 的 **Summary**，或 `Upload a private 10 MiB random object` 步骤中的单行 JSON。
- Run 的 Artifacts 提供 `cos-benchmark-<Run ID>-<attempt>`，其中只有安全的 `cos-benchmark-result.json` 指标，保留 7 天，不包含凭据、随机文件内容或签名 URL。
- 记录 `object_key`、`file_bytes`、`sha256`、`elapsed_ns`、`elapsed_seconds`、`average_mib_per_second`、`status`、`error_category`、`http_status`。
- `average_mib_per_second = (file_bytes / 1,048,576) / elapsed_seconds`。计时使用单调高精度计数器，JSON 保留纳秒差及秒值，Summary 显示秒和 MiB/s。
- **失败不把总文件大小当作已上传大小计算吞吐**：速率为 `null`，表示没有确认整个对象上传成功。失败退出码为 1，工作流明确失败。

连接超时 **10 秒**，读取响应的空闲超时 **120 秒**，单次请求整体另有 **600 秒**的有限时限，上传 step 最长 11 分钟。SDK `retry=0`、HTTP adapter `max_retries=0`，也关闭重定向和自动切换域名；只尝试一次，不用重试掩盖真实速度。安装 Python 依赖的下载重试与测速请求无关。

| 错误类别 | 含义 |
| --- | --- |
| `PERMISSION_ERROR` | COS 返回 401/403，检查子用户对象授权、凭据和签名时间；不回放服务端原始错误内容 |
| `CONNECT_TIMEOUT` | TCP/TLS 连接阶段超时 |
| `READ_TIMEOUT` | 等待响应或相关 socket I/O 超时 |
| `NETWORK_ERROR` | DNS、连接重置、代理或其他连接异常 |
| `TLS_ERROR` | 证书或 TLS 校验失败，禁止通过关闭证书校验绕过 |
| `TOTAL_TIMEOUT` | 单次 PutObject 达到 600 秒总期限 |
| `ENDPOINT_REDIRECT` | 返回 3xx，不将重定向当作上传成功，也不转发签名去其他地址 |
| `COS_SERVICE_ERROR` | 其他 COS HTTP 错误，如 5xx，记录安全的数字状态码而不重试 |
| `CONFIGURATION_ERROR` | 缺少 Secret、Bucket 不匹配或 Run ID 无效，未发请求 |
| `SDK_CLIENT_ERROR` / `INTERNAL_ERROR` | 无法可靠归类的异常，不通过打印原始异常来诊断 |

SDK 原始日志被抑制，错误分类检查异常类型和异常链，不解析/输出可能含凭据的异常文本；不打印 SecretId、SecretKey、Authorization、SDK response body 或签名 URL。若上传响应丢失，即使工作流失败，对象也可能已成功写入；按已记录 Key 在控制台核对，不自动重试或删除。

## 3. 在腾讯云控制台生成私有对象临时下载链接

这一步由管理员后续手动操作，不是本工作流的一部分：

1. 登录腾讯云控制台 → 对象存储 COS → 上述桶 → 文件列表，定位 Summary 中的完整 Key。
2. 打开对象详情，使用 **复制链接 / 生成临时链接 / 预签名 URL** 功能（控制台版本按钮名称可能不同）。选择默认 COS 域名、HTTPS、GET 下载方法，设置较短有效期，例如 **15 分钟**。
3. 保持私有读写；不要选择修改公有读权限、发布永久链接或 CDN 公网分发。
4. 临时链接本身是有时效的访问凭证。只在受信任终端使用，不发到 PR、聊天、Actions 日志、截图或公共文档中。过期后重新生成，不延长到永久。

生成链接的账户必须有目标对象 GetObject 权限。若测速子用户不能列桶、控制台不能浏览对象，使用已有适当授权的管理员账户按已知 Key 操作，不为此给测速子用户新增全局或桶管理权限。

## 4. Ubuntu 上用 curl 测试下载速度

以下只是供管理员后续执行的**只读下载**说明；本轮不执行，也不涉及 Docker 或其他容器。请使用普通管理终端，在自己的测速临时目录保存测试文件，不覆盖网站目录。

不要把 `169.254.0.47` 直接写进签名 URL，不使用 `--insecure` 或修改 Host：保留签名链接中的桶域名以维持 TLS 和签名校验。Ubuntu 上该 COS 域名解析到 `169.254.0.47` 是已有观测，实际下载仍取决于当前 DNS/路由；GitHub Runner 使用其正常公网 DNS，不强制使用这个内网 IP。

在 **Bash** 执行以下命令。URL 通过隐藏输入和 curl 的 stdin 配置传递，不出现在 curl 命令行参数、Shell 历史或正常输出中；保持 `set +x`，不要启用 curl `-v` 或 `--trace`。

```bash
set +x
set -o pipefail
BENCHMARK_DIR=$(mktemp -d "${TMPDIR:-/tmp}/ekiden-cos-download.XXXXXX")
chmod 700 "$BENCHMARK_DIR"
cd "$BENCHMARK_DIR"
read -r -s -p '临时 HTTPS 签名 GET 链接（不会显示）: ' COS_SIGNED_URL
printf '\n'
# 使用控制台默认 COS 域名；拒绝能改变 curl 配置行结构的字符。
if [[ "$COS_SIGNED_URL" != https://ekiden-deploy-test-1416877161.cos.ap-shanghai.myqcloud.com/benchmarks/* ]] ||
   [[ "$COS_SIGNED_URL" == *'"'* || "$COS_SIGNED_URL" == *'\'* || "$COS_SIGNED_URL" == *$'\r'* ]]; then
  unset COS_SIGNED_URL
  printf '不是预期 COS 对象链接，停止。\n'
else
  if printf 'url = "%s"\n' "$COS_SIGNED_URL" | curl --disable --config - \
      --silent --fail --proto '=https' --connect-timeout 10 --max-time 600 --retry 0 \
      --output test-10m.bin \
      --write-out 'http=%{http_code} bytes=%{size_download} seconds=%{time_total} bytes_per_second=%{speed_download}\n'; then
    printf '下载完成，继续核对大小和 SHA-256。\n'
  else
    rm -f -- test-10m.bin
    printf '下载失败或超时，检查临时链接是否过期、对象权限及网络；不要打印链接。\n'
  fi
  unset COS_SIGNED_URL
fi
printf '本地测速目录：%s\n' "$BENCHMARK_DIR"
```

未启用 `--location`，不会把签名转发到重定向目的地。curl 原始错误不回显，避免异常时泄露链接；用固定的状态码与统计信息判断成功。`speed_download` 是字节/秒，除以 **1,048,576** 得 MiB/s；`time_total` 包含连接和下载开销。HTTP 必须为 200，文件字节数必须为 10,485,760，之后还须验证哈希。

## 5. 验证 SHA-256

在上一步的测速目录中，复制 Actions Summary 的 **SHA-256 值**（不是链接或凭据）：

```bash
stat -c 'bytes=%s' test-10m.bin
read -r -p 'Actions Summary 中的64位小写 SHA-256: ' EXPECTED_SHA256
if [[ "$EXPECTED_SHA256" =~ ^[0-9a-f]{64}$ ]]; then
  printf '%s  test-10m.bin\n' "$EXPECTED_SHA256" | sha256sum --check -
else
  printf 'SHA-256 格式无效。\n'
fi
unset EXPECTED_SHA256
```

预期输出 `test-10m.bin: OK`，且大小为 10,485,760 字节。COS ETag 不等同于这里的 SHA-256，不用 ETag 代替验证。若尺寸或哈希不一致，不据此接受测速结果或用于部署。

## 6. 测试结束后清理

上传测速工作流**不会删除 COS 文件**，便于后续 Ubuntu 下载测试。完成测量和哈希核对后，由管理员：

1. 在 COS 控制台定位对应 `benchmarks/<Run ID>/test-10m.bin`，只删除该测试对象，确认 Key 与记录一致。
2. 不删除整个桶、其他 Run 的对象或其他项目数据，不修改桶 ACL 或扩大 IAM 权限。若桶已有版本控制，按既有管理规则清理相应测试版本，不变更版本控制设置。
3. 删除自己的本地 `test-10m.bin` 并按需移除测速临时目录；保留不含凭据的结果 JSON/哈希用于比较。临时签名链接等待过期，不分享或长期保存。

## 本地/PR 验证（不执行真实测速）

```bash
COS_TEST_ENV=$(mktemp -d "${TMPDIR:-/tmp}/ekiden-cos-tests.XXXXXX")
python3 -m venv "$COS_TEST_ENV"
"$COS_TEST_ENV/bin/python" -m pip install -r ops/requirements-cos-benchmark.txt
"$COS_TEST_ENV/bin/python" tests/cos_benchmark_test.py
# 只删除本段刚创建的测试虚拟环境：
rm -rf -- "$COS_TEST_ENV"
unset COS_TEST_ENV
```

测试运行真实的官方 SDK 签名/PutObject 路径，但 HTTP transport 是内存替身，并禁止 socket connect；不使用真实 COS 凭据、不上传对象。覆盖随机文件尺寸及 SHA、精确计时/吞吐、单次 PUT、零重试、超时类型、403/5xx、重定向拒绝及日志/报告脱敏。PR CI 只执行这些离线测试，不绑定 COS Secrets，不启动真实测速。
