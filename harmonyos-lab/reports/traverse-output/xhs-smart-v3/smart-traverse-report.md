# xhs_hos · 认知驱动深度遍历报告（安全模式）

- 目标包: `com.xingin.xhs_hos`
- 设备: `22M0223824043030`
- 遍历界面数: 3
- 总点击: 8（跳过/护栏: 3）
- 新界面: 4
- 是否中止: false

## 安全护栏
- 弹窗 (`hasModal`) 时仅点击：同意/确定/知道了 等
- 永不点击：不同意/拒绝/取消
- 点击前/后校验前台包名与 layout 中的 bundle
- 桌面 (`sceneboard`) 或误开其他 App 时停止并重新 `open` 目标应用
- 仅当 layout 含目标包时才递归子界面

### s1_d0 (depth 0)
- 父动作: root
- 计划点击 (6):
  - [content-card] 《小红书用户服务协议》 → (1101, 2132)
  - [content] 在线协议 → (69, 181)
  - [content] English Version → (208, 379)
  - [content] 小红书用户隐私权政策（简明版） → (379, 717)
  - [content] rednote Privacy Policy → (1270, 1623)
  - [content] 《小红书出海电商业务个人信息处理知情同意书》 → (750, 2235)
- 执行结果:
  - [content-card] press 1101 2132 (《小红书用户服务协议》): 无变化 (102→102)
  - [content] press 69 181 (在线协议): **新界面** (102→323)
  - [content] press 208 379 (English Version): **跳过** (wrong_app)
### s2_d1 (depth 1)
- 父动作: [content] press 69 181 (在线协议)
- 计划点击 (10):
  - [top-action] 关注 → (939, 181)
  - [top-action] 发现 → (1113, 181)
  - [top-action] 附近 → (1287, 181)
  - [top-action] Row → (63, 182)
  - [top-action] Row → (2162, 182)
  - [button] 微信登录 → (1113, 1917)
  - [content-card] 昨晚在海淀的洗脚城点了一个985研究生, 梅西在哟西, 146 → (376, 1917)
  - [content-card] 登录发现更多精彩 → (376, 1917)
  - [content-card] 打这玩意儿太上瘾了 , 年轻人小邹, 23.4万 → (1113, 1917)
  - [content-card] 其他登录方式 → (1113, 1917)
- 执行结果:
  - [top-action] press 939 181 (关注): **新界面** (323→283)
  - [top-action] press 1113 181 (发现): **跳过** (wrong_app)
### s3_d2 (depth 2)
- 父动作: [top-action] press 939 181 (关注)
- 计划点击 (10):
  - [top-action] 关注 → (939, 181)
  - [top-action] 发现 → (1113, 181)
  - [top-action] 附近 → (1287, 181)
  - [top-action] Row → (63, 182)
  - [top-action] Row → (2162, 182)
  - [content-card] 昨晚在海淀的洗脚城点了一个985研究生, 梅西在哟西, 146 → (376, 1917)
  - [content-card] 登录发现更多精彩 → (376, 1917)
  - [content-card] 打这玩意儿太上瘾了 , 年轻人小邹, 23.4万 → (1113, 1917)
  - [content-card] Stack → (1113, 1917)
  - [content-card] 本命偶像竟然跟我是同桌！！！, 子一ZoYee, 3.7万 → (1849, 1917)
- 执行结果:
  - [top-action] press 939 181 (关注): **新界面** (283→271)
  - [top-action] press 1113 181 (发现): **新界面** (283→269)
  - [top-action] press 1287 181 (附近): **跳过** (wrong_app)

生成时间: 2026-05-26T10:57:50.354Z