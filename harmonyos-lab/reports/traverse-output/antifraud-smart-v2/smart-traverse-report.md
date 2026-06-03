# hmy · 认知驱动深度遍历报告（安全模式）

- 目标包: `com.hicorenational.antifraud.hmy`
- 设备: `22M0223824043030`
- 遍历界面数: 4
- 总点击: 22（跳过/护栏: 1）
- 新界面: 7
- 是否中止: false

## 安全护栏
- 弹窗 (`hasModal`) 时仅点击：同意/确定/知道了 等
- 永不点击：不同意/拒绝/取消
- 点击前/后校验前台包名与 layout 中的 bundle
- 桌面 (`sceneboard`) 或误开其他 App 时停止并重新 `open` 目标应用
- 仅当 layout 含目标包时才递归子界面

### s1_d0 (depth 0)
- 父动作: root
- 计划点击 (1):
  - [content] Image → (72, 183)
- 执行结果:
  - [content] press 72 183 (Image@72,183): **新界面** (64→73)
### s2_d1 (depth 1)
- 父动作: [content] press 72 183 (Image@72,183)
- 计划点击 (9):
  - [button] 登录 → (1112, 1147)
  - [content-card] Image → (1112, 2192)
  - [content] TextInput → (1112, 535)
  - [content] TextInput → (1112, 726)
  - [content] Stack → (2115, 726)
  - [content] polcy → (100, 891)
  - [content] 登录即同意《服务协议》和《隐私政策》 → (537, 891)
  - [content] 快速注册 → (976, 1350)
  - [content] 找回密码 → (1247, 1350)
- 执行结果:
  - [button] press 1112 1147 (登录): 无变化 (73→73)
  - [content-card] press 1112 2192 (Image@1112,2192): 无变化 (73→73)
  - [content] press 1112 535 (TextInput@1112,535): **新界面** (73→117)
  - [content] press 1112 726 (TextInput@1112,726): **新界面** (74→78)
  - [content] press 2115 726 (Stack@2115,726): 无变化 (73→73)
  - [content] press 100 891 (polcy): 无变化 (73→73)
  - [content] press 537 891 (登录即同意《服务协议》和《隐私政策》): 无变化 (73→64)
  - [content] press 976 1350 (快速注册): 无变化 (73→64)
  - [content] press 1247 1350 (找回密码): 无变化 (73→64)
### s3_d2 (depth 2)
- 父动作: [content] press 1112 535 (TextInput@1112,535)
- 计划点击 (10):
  - [button] 登录 → (1112, 1147)
  - [content-card] - → (255, 1840)
  - [content-card] = → (255, 1968)
  - [content-card] / → (255, 2095)
  - [content] TextInput → (1112, 535)
  - [content] TextInput → (1112, 726)
  - [content] Stack → (2115, 726)
  - [content] polcy → (100, 891)
  - [content] 登录即同意《服务协议》和《隐私政策》 → (537, 891)
  - [content] 快速注册 → (976, 1350)
- 执行结果:
  - [button] press 1112 1147 (登录): 无变化 (117→117)
  - [content-card] press 255 1840 (-): **新界面** (117→130)
  - [content-card] press 255 1968 (=): **新界面** (117→74)
  - [content-card] press 255 2095 (/): **跳过** (launcher)
### s4_d2 (depth 2)
- 父动作: [content] press 1112 726 (TextInput@1112,726)
- 计划点击 (8):
  - [button] 登录 → (1112, 1147)
  - [content] - → (1112, 535)
  - [content] Image → (2079, 536)
  - [content] TextInput → (1112, 726)
  - [content] Stack → (2115, 726)
  - [content] polcy → (100, 891)
  - [content] 登录即同意《服务协议》和《隐私政策》 → (537, 891)
  - [content] 密码保险箱 → (1112, 1378)
- 执行结果:
  - [button] press 1112 1147 (登录): 无变化 (78→78)
  - [content] press 1112 535 (-): **新界面** (78→117)
  - [content] press 2079 536 (Image@2079,536): 无变化 (78→73)
  - [content] press 1112 726 (TextInput@1112,726): **新界面** (78→77)
  - [content] press 2115 726 (Stack@2115,726): 无变化 (78→73)
  - [content] press 100 891 (polcy): 无变化 (78→73)
  - [content] press 537 891 (登录即同意《服务协议》和《隐私政策》): 无变化 (78→64)
  - [content] press 1112 1378 (密码保险箱): 无变化 (78→64)

生成时间: 2026-05-25T10:48:33.442Z