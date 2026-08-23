# 🛍️ Personal Shopper AI

[English](README.md) · [한국어](README_KO.md) · [中文](README_ZH.md) · [日本語](README_JA.md)

> 一个私人的 AI 购物助手：记住你的购买习惯，比价多个商城，并帮助你更快做出更好的购买决定。

## 问题

> 大多数人只会在自己习惯的商城里买东西,从来不会去想别处是不是更便宜,结果总是买贵了。我自己也是这样——光是改掉这一个习惯,就让我的支出减少了15%到50%。

要找到更便宜的商品，人们必须在淘宝、京东、拼多多等多个购物网站之间反复切换，并且自己记住常购商品、品牌偏好和价格敏感度。百货商店有私人购物顾问，但个人在线购物通常没有。

## 解决方案

Personal Shopper AI 在本地 SQLite 中保存你的购物记录，理解兴趣、复购习惯和价格偏好，再通过公开商品与价格信息推荐更便宜或更合适的选择。

- 比较不同商城的公开价格
- 根据购买历史提供个性化推荐
- 把海外商城的商品名称和搜索词翻译成你熟悉的表达方式
- **购物助手提醒**：热门降价、每月预计省多少钱、该补货了、目标价提醒、海外直购划算与否(含预估关税/运费)、价格走势建议 —— 六种提醒都会存进数据库,一旦点掉就不会再出现

购买记录通过浏览器自动化从用户选择的、已登录的 Chrome 浏览器导入；无需扩展、凭据导出或额外安装。密码不会保存到应用数据库。系统只用公开的商品与价格信息做比较。没有应用内聊天窗口 —— 注册商城、提问都是直接让 AI 编程代理通过 chrome_bridge 操作。

## 工作原理 —— 一句话说清楚

如果你把这个仓库的链接丢给 AI 代理,它多半会问"这是什么",一句话说清楚就是:**[MeshCode.ai](https://meshcode.ai) 充当远程控制器,和你的真实 Chrome 浏览器通信,直接把你在各个商城的购买记录取回来**(不是抓取代理,用的是你自己已登录的会话);再根据你已经注册的这些商城,推断出"你大概在哪个国家购物",进而扩展去搜索该国用户常用的其他主要商城的商品。它把这些购买记录当作依据,在多个商城之间比较相同或相似的商品,把你推向**更便宜、更理性的消费**——而不是当前商城想卖给你的东西。

```
你已登录的真实 Chrome 浏览器
        ↓ MeshCode.ai chrome_bridge(远程控制,不是抓取代理)
   导入购买记录 → 本地 SQLite(仅保存在本机)
        ↓                                  ↘
记住偏好 · 商品打标签                    已注册商城域名 → 推断所在国家
        ↓                                  ↓
跨商城公开比价                          推荐该国用户常用的其他商城
        ↓                                  ↙
        购物助手提醒 + 个性化推荐
```

`chrome_bridge` 是 [MeshCode.ai](https://meshcode.ai) 提供的免费工具。

## 购物助手提醒

`GET /api/insights` 提供顶部横幅数据；点掉的提醒会在数据库里标记为已关闭(`DELETE /api/insights/:id`),之后重新扫描也不会再出现。

| 类型 | 内容 | 触发条件 |
| --- | --- | --- |
| `hot_deal` | "在 XX 商城买便宜 N%"(可解析数量时附单价) | 购买记录比价发现降价 ≥15% |
| `monthly_saving` | "每月大约能省 N 元" | 复购 2 次以上的商品，按实际购买频率折算月度节省 |
| `restock_reminder` | "差不多该补货了" | 距上次购买时间 ≥ 平均复购间隔的 80% |
| `watchlist_hit` | "目标价已达到" | 商品卡片 🎯 按钮设置的目标价被满足 |
| `overseas_arbitrage` | "海外直购扣除运费/关税后仍便宜 N%" | 时尚/电子/美妆类目 + 价格 ≥ 3 万韩元 + 预估节省 ≥10% |
| `price_timing` | "现在是近期最低价" / "最近偏贵，可以再等等" | 同一商品已积累 3 次以上比价历史 |

另外还有 `GET /api/spending/report`(按最近购买日期滚动比较最近 30 天与前 30 天的分类支出)和 `PATCH /api/products/:id/watch`(设置或清除目标价)。海外关税/运费为简化估算，实际税率因商品而异，详见 `README_KO.md`。

## 演示

![Personal Shopper AI demo](docs/assets/demo-web-ui-zh.png)

## 🤖 AI 代理配置指南

不需要自己写代码 —— 把这个仓库的链接交给你自己的编程 AI 代理(Claude Code、MeshCode 等),让它"通过 chrome bridge 帮我配置好"即可,代理可以自主完成整个流程:

1. **启动服务** —— 克隆仓库、`bun install`、`cp .env.example .env`、`bun run db:migrate`、`bun run dev`。
2. **询问你两件事** —— 你常用哪些购物网站,以及是否已经在这个浏览器里登录了这些网站。注册第一个网站后,代理可以调用 `GET /api/shops/suggestions` —— 它会根据该网站的域名推断你所在的国家(目前支持 KR/US/CN/JP),并返回该国用户常用的其他购物网站,让代理能主动问一句"你在用 Coupang,应该是在韩国购物吧——是不是也常用 11st 或 Musinsa?",而不是只登记你主动提到的网站。这个接口从不会自动注册候选网站,只有你确认过的才会被加入。
3. **导入真实购买记录** —— 使用 **MeshCode chrome_bridge**(其浏览器自动化工具)打开你已登录的 Chrome 会话,抓取每个网站的订单历史,并 POST 到本应用的导入接口。如果某个网站碰到登录墙,代理不应该放弃——chrome_bridge 驱动的是一个可见的浏览器,它会提示你在窗口里登录,用 `handoff` 把操作权交给你,你登录完成后再用 `takeover` 拿回控制权继续抓取:
   ```bash
   curl -X POST localhost:8787/api/shops -H 'content-type: application/json' \
     -d '{"name": "Coupang", "base_url": "https://www.coupang.com", "order_history_url": "https://www.coupang.com/mypage/orders"}'
   curl -X POST localhost:8787/api/shops/{id}/purchases/import -d '{"orders": [...]}'
   ```
4. **分析并完成** —— 代理调用分析接口,让推荐结果个性化:
   ```bash
   curl -X POST localhost:8787/api/analyze
   ```

全程不导出密码、不上传任何凭据 —— 代理只是操作你本机已登录的浏览器会话。打开 `http://localhost:8787` 即可看到属于你自己的个性化购物助手。

## 本地运行

```bash
bun install
cp .env.example .env
bun run db:migrate
bun run dev
```

打开 `http://localhost:8787`。
