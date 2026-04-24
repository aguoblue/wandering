export interface Activity {
  id: string;
  time: string;
  period: string; // 上午、中午、下午、晚上
  title: string;
  description: string;
  reason: string;
  duration: string;
  transport: string;
  alternatives: string[];
  coordinates: [number, number];
}

export interface Day {
  day: number;
  date: string;
  activities: Activity[];
}

export interface TravelPlan {
  id: string;
  name: string;
  tags: string[];
  duration: string;
  highlight: string;
  walkingIntensity: string;
  budget: string;
  image: string;
  days: Day[];
  destination: string;
}

export const mockPlans: TravelPlan[] = [
  {
    id: '1',
    name: '杭州西湖悠然之旅',
    tags: ['轻松', '打卡', '雨天适配'],
    duration: '2天1晚',
    highlight: '漫步苏堤、品龙井茶、赏西湖夜景，感受江南诗意',
    walkingIntensity: '低 (5-8km/天)',
    budget: '¥800-1200',
    image: 'https://images.unsplash.com/photo-1586862118451-efc84a66e704?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHx3ZXN0JTIwbGFrZSUyMGhhbmd6aG91JTIwY2hpbmElMjBzY2VuaWN8ZW58MXx8fHwxNzc1NTQ3MjgwfDA&ixlib=rb-4.1.0&q=80&w=1080',
    destination: '杭州',
    days: [
      {
        day: 1,
        date: '2026-04-10',
        activities: [
          {
            id: '1-1',
            time: '09:00-12:00',
            period: '上午',
            title: '西湖 + 苏堤',
            description: '从断桥残雪开始，沿着苏堤漫步至花港观鱼，全程约3公里',
            reason: '春季正值桃花盛开，苏堤春晓是西湖十景之首。早晨游客较少，适合拍照和散步。',
            duration: '2-3小时',
            transport: '步行为主，可租自行车',
            alternatives: ['白堤 + 孤山', '杨公堤（更清静）'],
            coordinates: [120.1458, 30.2444]
          },
          {
            id: '1-2',
            time: '12:00-13:30',
            period: '中午',
            title: '外婆家（湖滨店）',
            description: '杭州本地连锁餐厅，性价比高，推荐西湖醋鱼、东坡肉',
            reason: '地理位置便利，就在西湖边，菜品地道且价格适中。',
            duration: '1-1.5小时',
            transport: '从苏堤步行15分钟',
            alternatives: ['知味观（老字号）', '绿茶餐厅'],
            coordinates: [120.1562, 30.2536]
          },
          {
            id: '1-3',
            time: '14:00-17:00',
            period: '下午',
            title: '浙江博物馆（孤山馆区）',
            description: '免费开放，馆藏丰富，雨天友好。附近有西泠印社和楼外楼。',
            reason: '下午如果天气不好可以避雨，而且可以深入了解浙江历史文化。',
            duration: '2-3小时',
            transport: '从湖滨区乘公交或打车10分钟',
            alternatives: ['中国丝绸博物馆', '中国茶叶博物馆'],
            coordinates: [120.1387, 30.2511]
          },
          {
            id: '1-4',
            time: '19:00-21:00',
            period: '晚上',
            title: '西湖音乐喷泉 + 湖滨夜市',
            description: '欣赏音乐喷泉表演（19:00和20:00两场），然后逛湖滨银泰、河坊街',
            reason: '西湖夜景美轮美奂，音乐喷泉是免费的视觉盛宴，夜市可以品尝小吃。',
            duration: '2小时',
            transport: '步行即可到达',
            alternatives: ['灵隐寺夜游', '钱江新城灯光秀'],
            coordinates: [120.1590, 30.2550]
          }
        ]
      },
      {
        day: 2,
        date: '2026-04-11',
        activities: [
          {
            id: '2-1',
            time: '08:30-11:00',
            period: '上午',
            title: '灵隐寺 + 飞来峰',
            description: '杭州最著名的寺庙，飞来峰石刻值得一看',
            reason: '清晨香火鼎盛但不拥挤，空气清新，适合静心参观。',
            duration: '2-3小时',
            transport: '从市区打车或乘7路公交',
            alternatives: ['法喜寺（网红寺庙）', '净慈寺'],
            coordinates: [120.0985, 30.2416]
          },
          {
            id: '2-2',
            time: '11:30-13:00',
            period: '中午',
            title: '龙井村农家菜',
            description: '品尝龙井茶和当地农家菜，如龙井虾仁、笋干老鸭煲',
            reason: '龙井村环境优美，可以顺便参观茶园，体验采茶（4月正值明前茶季）。',
            duration: '1.5小时',
            transport: '从灵隐寺乘公交或打车15分钟',
            alternatives: ['梅家坞茶村', '九溪烟树附近餐厅'],
            coordinates: [120.1180, 30.2380]
          },
          {
            id: '2-3',
            time: '14:00-16:00',
            period: '下午',
            title: '中国茶叶博物馆 + 茶园漫步',
            description: '免费参观，了解中国茶文化，周边茶园景色宜人',
            reason: '紧邻龙井村，可以系统学习茶文化，还能在茶园拍美照。',
            duration: '2小时',
            transport: '步行10分钟',
            alternatives: ['九溪十八涧（徒步路线）', '虎跑公园'],
            coordinates: [120.1170, 30.2115]
          },
          {
            id: '2-4',
            time: '17:00-18:30',
            period: '晚上',
            title: '返程或延伸行程',
            description: '可选择直接返程，或前往河坊街购买伴手礼',
            reason: '河坊街有各种杭州特产，如西湖藕粉、龙井茶、丝绸制品。',
            duration: '1.5小时',
            transport: '乘公交返回市区',
            alternatives: ['南宋御街', '湖滨银泰购物'],
            coordinates: [120.1653, 30.2463]
          }
        ]
      }
    ]
  },
  {
    id: '2',
    name: '北京古都文化探索',
    tags: ['文化', '打卡', '深度游'],
    duration: '3天2晚',
    highlight: '故宫深度游、长城日出、胡同文化体验',
    walkingIntensity: '中高 (10-15km/天)',
    budget: '¥1500-2500',
    image: 'https://images.unsplash.com/photo-1551101571-64d951840a86?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxmb3JiaWRkZW4lMjBjaXR5JTIwYmVpamluZyUyMHRlbXBsZXxlbnwxfHx8fDE3NzU1NDcyODF8MA&ixlib=rb-4.1.0&q=80&w=1080',
    destination: '北京',
    days: [
      {
        day: 1,
        date: '2026-05-01',
        activities: [
          {
            id: '3-1',
            time: '08:00-12:00',
            period: '上午',
            title: '天安门广场 + 故宫博物院',
            description: '从天安门进入，完整游览故宫中轴线及东西六宫',
            reason: '提前预约门票，早上8点入场避开高峰。故宫需要至少半天时间。',
            duration: '4小时',
            transport: '地铁1号线天安门东站',
            alternatives: ['国家博物馆', '景山公园（俯瞰故宫）'],
            coordinates: [116.3972, 39.9163]
          },
          {
            id: '3-2',
            time: '12:30-14:00',
            period: '中午',
            title: '王府井小吃街',
            description: '体验北京传统小吃：炸酱面、豆汁、驴打滚',
            reason: '步行即达，品种丰富，可以一次尝遍北京特色。',
            duration: '1.5小时',
            transport: '从故宫步行15分钟',
            alternatives: ['全聚德烤鸭', '东来顺涮羊肉'],
            coordinates: [116.4144, 39.9144]
          },
          {
            id: '3-3',
            time: '15:00-18:00',
            period: '下午',
            title: '什刹海 + 南锣鼓巷',
            description: '游览后海，逛南锣鼓巷文艺小店，体验老北京胡同',
            reason: '下午光线适合拍照，可以租船游后海，傍晚时分氛围最佳。',
            duration: '3小时',
            transport: '乘地铁或公交20分钟',
            alternatives: ['鼓楼 + 烟袋斜街', '恭王府'],
            coordinates: [116.3908, 39.9392]
          }
        ]
      },
      {
        day: 2,
        date: '2026-05-02',
        activities: [
          {
            id: '4-1',
            time: '06:00-13:00',
            period: '上午',
            title: '慕田峪长城',
            description: '相比八达岭更清静，可乘缆车上下，体力好可徒步',
            reason: '早起看日出（可选），避开旅游团，景色壮观且游客相对较少。',
            duration: '6-7小时（含往返）',
            transport: '报一日游或包车前往（2小时车程）',
            alternatives: ['八达岭长城', '金山岭长城'],
            coordinates: [116.5704, 40.4319]
          },
          {
            id: '4-2',
            time: '18:00-20:00',
            period: '晚上',
            title: '三里屯 + 朝阳大悦城',
            description: '现代北京的代表，品尝各国美食，体验夜生活',
            reason: '爬长城后需要轻松活动，三里屯适合晚餐和散步。',
            duration: '2小时',
            transport: '地铁10号线',
            alternatives: ['簋街（宵夜）', '五道口（大学氛围）'],
            coordinates: [116.4550, 39.9371]
          }
        ]
      },
      {
        day: 3,
        date: '2026-05-03',
        activities: [
          {
            id: '5-1',
            time: '08:00-11:00',
            period: '上午',
            title: '颐和园',
            description: '皇家园林，游览长廊、佛香阁、昆明湖',
            reason: '春季景色最美，可乘船游湖，感受皇家园林的恢弘气势。',
            duration: '3小时',
            transport: '地铁4号线北宫门站',
            alternatives: ['圆明园遗址', '香山公园'],
            coordinates: [116.2753, 40.0009]
          },
          {
            id: '5-2',
            time: '12:00-14:00',
            period: '中午',
            title: '中关村美食',
            description: '各种餐厅选择，从快餐到正餐都有',
            reason: '颐和园附近餐饮选择多，可以根据时间灵活安排。',
            duration: '1-2小时',
            transport: '地铁4号线',
            alternatives: ['清华/北大食堂体验', '五道营胡同'],
            coordinates: [116.3142, 39.9787]
          },
          {
            id: '5-3',
            time: '15:00-17:00',
            period: '下午',
            title: '798艺术区',
            description: '当代艺术画廊、创意商店、咖啡馆',
            reason: '感受北京的艺术氛围，适合拍照和购买文创产品。',
            duration: '2小时',
            transport: '地铁14号线',
            alternatives: ['清华大学校园', '北京大学未名湖'],
            coordinates: [116.4964, 39.9845]
          }
        ]
      }
    ]
  },
  {
    id: '3',
    name: '上海摩登都市游',
    tags: ['美食', '摄影', '夜景'],
    duration: '2天1晚',
    highlight: '外滩夜景、田子坊文艺、陆家嘴CBD体验',
    walkingIntensity: '中 (8-12km/天)',
    budget: '¥1200-2000',
    image: 'https://images.unsplash.com/photo-1647067151201-0b37c7555870?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxzaGFuZ2hhaSUyMGJ1bmQlMjBuaWdodCUyMHNreWxpbmV8ZW58MXx8fHwxNzc1NTQ3MjgxfDA&ixlib=rb-4.1.0&q=80&w=1080',
    destination: '上海',
    days: [
      {
        day: 1,
        date: '2026-06-15',
        activities: [
          {
            id: '6-1',
            time: '09:00-12:00',
            period: '上午',
            title: '豫园 + 城隍庙',
            description: '游览古典园林，品尝南翔小笼包',
            reason: '上海老城区代表，早上游客较少，可以慢慢欣赏园林艺术。',
            duration: '3小时',
            transport: '地铁10号线豫园站',
            alternatives: ['老码头', '新天地'],
            coordinates: [121.4920, 31.2287]
          },
          {
            id: '6-2',
            time: '14:00-17:00',
            period: '下午',
            title: '田子坊 + 法租界漫步',
            description: '逛文艺小店、咖啡馆，感受老上海风情',
            reason: '下午光线适合拍照，小资氛围浓厚，适合慢节奏闲逛。',
            duration: '3小时',
            transport: '地铁9号线打浦桥站',
            alternatives: ['思南公馆', '武康路'],
            coordinates: [121.4707, 31.2104]
          },
          {
            id: '6-3',
            time: '18:00-21:00',
            period: '晚上',
            title: '外滩 + 浦江夜游',
            description: '欣赏外滩万国建筑群，对岸是陆家嘴天际线',
            reason: '晚上7-9点灯光最美，可以选择乘游船或在外滩观景平台欣赏。',
            duration: '3小时',
            transport: '地铁2号线南京东路站',
            alternatives: ['陆家嘴观光厅', '东方明珠'],
            coordinates: [121.4900, 31.2397]
          }
        ]
      },
      {
        day: 2,
        date: '2026-06-16',
        activities: [
          {
            id: '7-1',
            time: '09:00-12:00',
            period: '上午',
            title: '上海博物馆',
            description: '免费开放，馆藏青铜器、陶瓷、书画等',
            reason: '雨天友好，中国最好的博物馆之一，建议提前预约。',
            duration: '3小时',
            transport: '地铁1/2/8号线人民广场站',
            alternatives: ['上海自然博物馆', '中华艺术宫'],
            coordinates: [121.4747, 31.2281]
          },
          {
            id: '7-2',
            time: '13:00-17:00',
            period: '下午',
            title: '陆家嘴 + 上海中心',
            description: '登上海中心118层观光厅，俯瞰全城',
            reason: '世界第二高楼，360度视角，天气晴朗时可看到很远。',
            duration: '3-4小时',
            transport: '地铁2号线陆家嘴站',
            alternatives: ['环球金融中心观光厅', '滨江大道散步'],
            coordinates: [121.5058, 31.2352]
          },
          {
            id: '7-3',
            time: '18:00-20:00',
            period: '晚上',
            title: '南京路步行街',
            description: '购物、品尝美食、感受上海商业氛围',
            reason: '晚上最热闹，霓虹灯璀璨，可以购买伴手礼。',
            duration: '2小时',
            transport: '地铁1/2号线人民广场站',
            alternatives: ['淮海路', '徐家汇'],
            coordinates: [121.4776, 31.2361]
          }
        ]
      }
    ]
  },
  {
    id: '4',
    name: '桂林山水田园诗',
    tags: ['自然', '摄影', '轻松'],
    duration: '3天2晚',
    highlight: '漓江竹筏漂流、遇龙河骑行、银子岩溶洞',
    walkingIntensity: '低 (3-6km/天)',
    budget: '¥1000-1800',
    image: 'https://images.unsplash.com/photo-1773318901379-aac92fdf5611?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxndWlsaW4lMjBrYXJzdCUyMG1vdW50YWlucyUyMHJpdmVyfGVufDF8fHx8MTc3NTU0NzI4MXww&ixlib=rb-4.1.0&q=80&w=1080',
    destination: '桂林',
    days: [
      {
        day: 1,
        date: '2026-09-20',
        activities: [
          {
            id: '8-1',
            time: '08:00-12:00',
            period: '上午',
            title: '漓江竹筏游（杨堤-兴坪）',
            description: '最精华的漓江段，20元人民币背景取景地',
            reason: '早晨江面雾气缭绕，光线柔和，是摄影最佳时间。',
            duration: '3-4小时',
            transport: '包车前往杨堤码头（1小时）',
            alternatives: ['漓江游船（桂林-阳朔）', '相公山日出'],
            coordinates: [110.4779, 24.8964]
          },
          {
            id: '8-2',
            time: '13:00-14:30',
            period: '中午',
            title: '兴坪古镇午餐',
            description: '品尝桂林米粉、啤酒鱼',
            reason: '竹筏终点就是兴坪，古镇保留原始风貌，适合午餐和短暂休息。',
            duration: '1.5小时',
            transport: '步行',
            alternatives: ['老根啤酒鱼', '大师傅啤酒鱼'],
            coordinates: [110.5008, 24.8889]
          },
          {
            id: '8-3',
            time: '15:00-18:00',
            period: '下午',
            title: '阳朔西街 + 十里画廊',
            description: '租电动车或自行车游览十里画廊沿途景点',
            reason: '下午温度适宜，可以骑行欣赏田园风光，傍晚返回西街。',
            duration: '3小时',
            transport: '从兴坪乘车到阳朔（30分钟）',
            alternatives: ['工农桥看日落', '阳朔书童山'],
            coordinates: [110.4973, 24.7758]
          },
          {
            id: '8-4',
            time: '19:00-21:00',
            period: '晚上',
            title: '《印象刘三姐》实景演出',
            description: '张艺谋导演，以漓江为背景的大型实景演出',
            reason: '全球最大的山水实景剧场，震撼的视听体验。',
            duration: '2小时',
            transport: '从西街打车10分钟',
            alternatives: ['西街夜市', '遇龙河夜游'],
            coordinates: [110.4695, 24.7836]
          }
        ]
      },
      {
        day: 2,
        date: '2026-09-21',
        activities: [
          {
            id: '9-1',
            time: '08:00-12:00',
            period: '上午',
            title: '遇龙河竹筏漂流',
            description: '从金龙桥到旧县码头，最美的遇龙河段',
            reason: '比漓江更静谧，河水清澈，两岸田园风光如画，适合悠闲漂流。',
            duration: '2-3小时',
            transport: '包车或骑车前往',
            alternatives: ['遇龙河骑行', '富里桥-遇龙桥段'],
            coordinates: [110.4189, 24.8436]
          },
          {
            id: '9-2',
            time: '14:00-17:00',
            period: '下午',
            title: '银子岩',
            description: '桂林最美的溶洞之一，钟乳石造型奇特',
            reason: '雨天友好，洞内恒温，被誉为"世界溶洞奇观"。',
            duration: '2-3小时',
            transport: '从阳朔包车前往（30分钟）',
            alternatives: ['芦笛岩', '冠岩'],
            coordinates: [110.3764, 25.0417]
          },
          {
            id: '9-3',
            time: '18:00-20:00',
            period: '晚上',
            title: '阳朔西街自由活动',
            description: '逛特色小店、品尝美食、体验酒吧街',
            reason: '西街晚上最热闹，中西合璧的氛围独特，适合拍照和休闲。',
            duration: '2小时',
            transport: '步行',
            alternatives: ['漓江边散步', '攀岩体验'],
            coordinates: [110.4973, 24.7758]
          }
        ]
      },
      {
        day: 3,
        date: '2026-09-22',
        activities: [
          {
            id: '10-1',
            time: '08:00-11:00',
            period: '上午',
            title: '象鼻山 + 两江四湖',
            description: '桂林市区标志性景点，可乘船游览',
            reason: '象鼻山是桂林的城市名片，早上游客少，适合拍照。',
            duration: '3小时',
            transport: '从阳朔返回桂林（1.5小时）',
            alternatives: ['叠彩山', '伏波山'],
            coordinates: [110.2819, 25.2691]
          },
          {
            id: '10-2',
            time: '12:00-14:00',
            period: '中午',
            title: '正阳步行街 + 桂林米粉',
            description: '品尝正宗的桂林米粉，崇善米粉、石记米粉都是老字号',
            reason: '不吃桂林米粉等于白来桂林，步行街汇集各种老字号。',
            duration: '2小时',
            transport: '步行',
            alternatives: ['尚水美食街', '万达广场'],
            coordinates: [110.2897, 25.2779]
          },
          {
            id: '10-3',
            time: '15:00-17:00',
            period: '下午',
            title: '东西巷 + 购买特产',
            description: '桂林老街区改造，可以购买桂花糕、辣椒酱等特产',
            reason: '适合买伴手礼，环境整洁，价格合理。',
            duration: '2小时',
            transport: '步行',
            alternatives: ['日月双塔', '靖江王城'],
            coordinates: [110.2908, 25.2833]
          }
        ]
      }
    ]
  },
  {
    id: 'sz-001',
    name: '深圳滨海一日漫游·美食与夕阳',
    tags: ['海滨', '美食', '摄影'],
    duration: '1天',
    highlight: '沿海岸线漫步，品尝特色粤菜，捕捉黄昏海景',
    walkingIntensity: '低 (5-8km/天)',
    budget: '¥700-1200',
    image: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800',
    destination: '深圳',
    days: [
      {
        day: 1,
        date: '2026-05-01',
        activities: [
          {
            id: '1-1',
            time: '08:00-10:30',
            period: '上午',
            title: '南山海滨公园晨间漫步',
            description: '沿着蛇口海滨公园的木栈道散步，欣赏晨曦中的深圳湾，拍摄海景和城市天际线。公园内有多个观景台和休闲座椅，适合拍照打卡。',
            reason: '避开中午人流，享受清爽的海风和柔和光线，为全天拍照积累素材',
            duration: '2.5小时',
            transport: '地铁2号线至蛇口港站，步行5分钟',
            alternatives: ['深圳湾公园', '前海滨河公园'],
            coordinates: [113.9244, 22.5089]
          },
          {
            id: '1-2',
            time: '11:00-13:00',
            period: '中午',
            title: '蛇口渔村特色粤菜午餐',
            description: '在蛇口渔村品尝新鲜海鲜粤菜，推荐清蒸石斑鱼、虾饺、蟹粉小馄饨等招牌菜。餐厅靠近海边，用餐环境开阔，可边吃边看海景。',
            reason: '蛇口渔村是深圳最地道的海鲜美食聚集地，食材新鲜价格相对亲民，是必尝体验',
            duration: '2小时',
            transport: '步行10分钟',
            alternatives: ['海上世界餐饮街', '南海意库美食广场'],
            coordinates: [113.9156, 22.5012]
          },
          {
            id: '1-3',
            time: '14:30-17:00',
            period: '下午',
            title: '海上世界创意园区逛街拍照',
            description: '漫步海上世界，欣赏改造后的工业建筑、艺术装置和创意店铺。园区内有多个网红拍照点，包括彩色集装箱、涂鸦墙和海景观景台。',
            reason: '集艺术、购物、拍照于一体，是深圳新晋打卡地，光线下午最佳',
            duration: '2.5小时',
            transport: '打车或步行15分钟',
            alternatives: ['华侨城创意园', '大芬油画村'],
            coordinates: [113.9089, 22.5078]
          },
          {
            id: '1-4',
            time: '17:30-19:30',
            period: '晚上',
            title: '深圳湾公园夕阳观景与晚餐',
            description: '在深圳湾公园的观景台欣赏日落，拍摄夕阳下的香港天际线和深圳湾全景。日落后在公园附近的餐厅享用晚餐，推荐海鲜烧烤或粤菜馆。',
            reason: '深圳湾夕阳是摄影爱好者必拍景点，黄金时段光线绝佳，晚餐可在此悠闲享用',
            duration: '2小时',
            transport: '地铁9号线至深圳湾公园站',
            alternatives: ['小梅沙海滨公园', '东部华侨城茶溪谷'],
            coordinates: [113.9289, 22.5329]
          }
        ]
      }
    ]
  }
];
