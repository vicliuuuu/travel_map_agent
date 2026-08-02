(function (globalScope) {
  "use strict";

  var COUNTRIES = [
    { code: "CN", name: "China", nameZh: "中国" },
    { code: "US", name: "United States", nameZh: "美国" },
    { code: "JP", name: "Japan", nameZh: "日本" },
    { code: "KR", name: "South Korea", nameZh: "韩国" },
    { code: "FR", name: "France", nameZh: "法国" },
    { code: "GB", name: "United Kingdom", nameZh: "英国" },
    { code: "DE", name: "Germany", nameZh: "德国" },
    { code: "IT", name: "Italy", nameZh: "意大利" },
    { code: "ES", name: "Spain", nameZh: "西班牙" },
    { code: "CH", name: "Switzerland", nameZh: "瑞士" },
    { code: "NL", name: "Netherlands", nameZh: "荷兰" },
    { code: "AU", name: "Australia", nameZh: "澳大利亚" },
    { code: "CA", name: "Canada", nameZh: "加拿大" },
    { code: "SG", name: "Singapore", nameZh: "新加坡" },
    { code: "TH", name: "Thailand", nameZh: "泰国" },
    { code: "VN", name: "Vietnam", nameZh: "越南" },
    { code: "MY", name: "Malaysia", nameZh: "马来西亚" },
    { code: "ID", name: "Indonesia", nameZh: "印度尼西亚" },
    { code: "AE", name: "United Arab Emirates", nameZh: "阿联酋" },
    { code: "TR", name: "Turkey", nameZh: "土耳其" },
    { code: "GR", name: "Greece", nameZh: "希腊" },
    { code: "PT", name: "Portugal", nameZh: "葡萄牙" },
    { code: "AT", name: "Austria", nameZh: "奥地利" },
    { code: "BE", name: "Belgium", nameZh: "比利时" },
    { code: "CZ", name: "Czech Republic", nameZh: "捷克" },
    { code: "HU", name: "Hungary", nameZh: "匈牙利" },
    { code: "PL", name: "Poland", nameZh: "波兰" },
    { code: "RU", name: "Russia", nameZh: "俄罗斯" },
    { code: "IN", name: "India", nameZh: "印度" },
    { code: "NZ", name: "New Zealand", nameZh: "新西兰" },
    { code: "CL", name: "Chile", nameZh: "智利" },
    { code: "MX", name: "Mexico", nameZh: "墨西哥" },
    { code: "BR", name: "Brazil", nameZh: "巴西" },
    { code: "EG", name: "Egypt", nameZh: "埃及" },
    { code: "MA", name: "Morocco", nameZh: "摩洛哥" },
    { code: "HK", name: "Hong Kong", nameZh: "中国香港" },
    { code: "TW", name: "Taiwan", nameZh: "中国台湾" },
    { code: "MO", name: "Macau", nameZh: "中国澳门" },
  ];

  var CITIES_BY_COUNTRY = {
    CN: [
      { name: "Beijing", nameZh: "北京" },
      { name: "Shanghai", nameZh: "上海" },
      { name: "Guangzhou", nameZh: "广州" },
      { name: "Shenzhen", nameZh: "深圳" },
      { name: "Chengdu", nameZh: "成都" },
      { name: "Hangzhou", nameZh: "杭州" },
      { name: "Xi'an", nameZh: "西安" },
      { name: "Chongqing", nameZh: "重庆" },
      { name: "Nanjing", nameZh: "南京" },
      { name: "Suzhou", nameZh: "苏州" },
      { name: "Wuhan", nameZh: "武汉" },
      { name: "Qingdao", nameZh: "青岛" },
      { name: "Xiamen", nameZh: "厦门" },
      { name: "Kunming", nameZh: "昆明" },
      { name: "Lhasa", nameZh: "拉萨" },
    ],
    US: [
      { name: "New York", nameZh: "纽约" },
      { name: "Los Angeles", nameZh: "洛杉矶" },
      { name: "San Francisco", nameZh: "旧金山" },
      { name: "Chicago", nameZh: "芝加哥" },
      { name: "Seattle", nameZh: "西雅图" },
      { name: "Las Vegas", nameZh: "拉斯维加斯" },
      { name: "Boston", nameZh: "波士顿" },
      { name: "Washington", nameZh: "华盛顿" },
      { name: "Miami", nameZh: "迈阿密" },
      { name: "Honolulu", nameZh: "檀香山" },
    ],
    JP: [
      { name: "Tokyo", nameZh: "东京" },
      { name: "Osaka", nameZh: "大阪" },
      { name: "Kyoto", nameZh: "京都" },
      { name: "Nagoya", nameZh: "名古屋" },
      { name: "Sapporo", nameZh: "札幌" },
      { name: "Fukuoka", nameZh: "福冈" },
      { name: "Hiroshima", nameZh: "广岛" },
      { name: "Nara", nameZh: "奈良" },
    ],
    KR: [
      { name: "Seoul", nameZh: "首尔" },
      { name: "Busan", nameZh: "釜山" },
      { name: "Jeju", nameZh: "济州" },
      { name: "Incheon", nameZh: "仁川" },
    ],
    FR: [
      { name: "Paris", nameZh: "巴黎" },
      { name: "Lyon", nameZh: "里昂" },
      { name: "Marseille", nameZh: "马赛" },
      { name: "Nice", nameZh: "尼斯" },
      { name: "Bordeaux", nameZh: "波尔多" },
    ],
    GB: [
      { name: "London", nameZh: "伦敦" },
      { name: "Edinburgh", nameZh: "爱丁堡" },
      { name: "Manchester", nameZh: "曼彻斯特" },
      { name: "Oxford", nameZh: "牛津" },
      { name: "Cambridge", nameZh: "剑桥" },
    ],
    DE: [
      { name: "Berlin", nameZh: "柏林" },
      { name: "Munich", nameZh: "慕尼黑" },
      { name: "Frankfurt", nameZh: "法兰克福" },
      { name: "Hamburg", nameZh: "汉堡" },
      { name: "Cologne", nameZh: "科隆" },
    ],
    IT: [
      { name: "Rome", nameZh: "罗马" },
      { name: "Milan", nameZh: "米兰" },
      { name: "Venice", nameZh: "威尼斯" },
      { name: "Florence", nameZh: "佛罗伦萨" },
      { name: "Naples", nameZh: "那不勒斯" },
    ],
    ES: [
      { name: "Madrid", nameZh: "马德里" },
      { name: "Barcelona", nameZh: "巴塞罗那" },
      { name: "Seville", nameZh: "塞维利亚" },
      { name: "Valencia", nameZh: "瓦伦西亚" },
    ],
    CH: [
      { name: "Zurich", nameZh: "苏黎世" },
      { name: "Geneva", nameZh: "日内瓦" },
      { name: "Bern", nameZh: "伯尔尼" },
      { name: "Lucerne", nameZh: "卢塞恩" },
      { name: "Interlaken", nameZh: "因特拉肯" },
    ],
    NL: [
      { name: "Amsterdam", nameZh: "阿姆斯特丹" },
      { name: "Rotterdam", nameZh: "鹿特丹" },
      { name: "The Hague", nameZh: "海牙" },
    ],
    AU: [
      { name: "Sydney", nameZh: "悉尼" },
      { name: "Melbourne", nameZh: "墨尔本" },
      { name: "Brisbane", nameZh: "布里斯班" },
      { name: "Perth", nameZh: "珀斯" },
    ],
    CA: [
      { name: "Toronto", nameZh: "多伦多" },
      { name: "Vancouver", nameZh: "温哥华" },
      { name: "Montreal", nameZh: "蒙特利尔" },
      { name: "Ottawa", nameZh: "渥太华" },
    ],
    SG: [{ name: "Singapore", nameZh: "新加坡" }],
    TH: [
      { name: "Bangkok", nameZh: "曼谷" },
      { name: "Chiang Mai", nameZh: "清迈" },
      { name: "Phuket", nameZh: "普吉" },
    ],
    VN: [
      { name: "Hanoi", nameZh: "河内" },
      { name: "Ho Chi Minh City", nameZh: "胡志明市" },
      { name: "Da Nang", nameZh: "岘港" },
    ],
    MY: [
      { name: "Kuala Lumpur", nameZh: "吉隆坡" },
      { name: "Penang", nameZh: "槟城" },
      { name: "Malacca", nameZh: "马六甲" },
    ],
    ID: [
      { name: "Jakarta", nameZh: "雅加达" },
      { name: "Bali", nameZh: "巴厘岛" },
      { name: "Yogyakarta", nameZh: "日惹" },
    ],
    AE: [
      { name: "Dubai", nameZh: "迪拜" },
      { name: "Abu Dhabi", nameZh: "阿布扎比" },
    ],
    TR: [
      { name: "Istanbul", nameZh: "伊斯坦布尔" },
      { name: "Ankara", nameZh: "安卡拉" },
      { name: "Cappadocia", nameZh: "卡帕多奇亚" },
    ],
    GR: [
      { name: "Athens", nameZh: "雅典" },
      { name: "Santorini", nameZh: "圣托里尼" },
      { name: "Thessaloniki", nameZh: "塞萨洛尼基" },
    ],
    PT: [
      { name: "Lisbon", nameZh: "里斯本" },
      { name: "Porto", nameZh: "波尔图" },
    ],
    AT: [
      { name: "Vienna", nameZh: "维也纳" },
      { name: "Salzburg", nameZh: "萨尔茨堡" },
    ],
    BE: [
      { name: "Brussels", nameZh: "布鲁塞尔" },
      { name: "Bruges", nameZh: "布鲁日" },
    ],
    CZ: [
      { name: "Prague", nameZh: "布拉格" },
      { name: "Cesky Krumlov", nameZh: "克鲁姆洛夫" },
    ],
    HU: [{ name: "Budapest", nameZh: "布达佩斯" }],
    PL: [
      { name: "Warsaw", nameZh: "华沙" },
      { name: "Krakow", nameZh: "克拉科夫" },
    ],
    RU: [
      { name: "Moscow", nameZh: "莫斯科" },
      { name: "Saint Petersburg", nameZh: "圣彼得堡" },
    ],
    IN: [
      { name: "New Delhi", nameZh: "新德里" },
      { name: "Mumbai", nameZh: "孟买" },
      { name: "Jaipur", nameZh: "斋浦尔" },
    ],
    NZ: [
      { name: "Auckland", nameZh: "奥克兰" },
      { name: "Queenstown", nameZh: "皇后镇" },
      { name: "Wellington", nameZh: "惠灵顿" },
    ],
    CL: [
      { name: "Santiago", nameZh: "圣地亚哥" },
      { name: "Valparaiso", nameZh: "瓦尔帕莱索" },
    ],
    MX: [
      { name: "Mexico City", nameZh: "墨西哥城" },
      { name: "Cancun", nameZh: "坎昆" },
    ],
    BR: [
      { name: "Rio de Janeiro", nameZh: "里约热内卢" },
      { name: "Sao Paulo", nameZh: "圣保罗" },
    ],
    EG: [
      { name: "Cairo", nameZh: "开罗" },
      { name: "Luxor", nameZh: "卢克索" },
    ],
    MA: [
      { name: "Marrakech", nameZh: "马拉喀什" },
      { name: "Casablanca", nameZh: "卡萨布兰卡" },
    ],
    HK: [{ name: "Hong Kong", nameZh: "香港" }],
    TW: [
      { name: "Taipei", nameZh: "台北" },
      { name: "Kaohsiung", nameZh: "高雄" },
    ],
    MO: [{ name: "Macau", nameZh: "澳门" }],
  };

  function normalizeSearchText(value) {
    return String(value || "").trim().toLowerCase();
  }

  function matchSearchText(query, candidates) {
    var normalizedQuery = normalizeSearchText(query);
    if (!normalizedQuery) {
      return true;
    }
    return candidates.some(function (candidate) {
      return normalizeSearchText(candidate).indexOf(normalizedQuery) !== -1;
    });
  }

  function formatCountryLabel(country) {
    return country.name + " / " + country.nameZh;
  }

  function formatCityLabel(city) {
    return city.name + " / " + city.nameZh;
  }

  function findCountryByInput(value) {
    var normalized = normalizeSearchText(value);
    if (!normalized) {
      return null;
    }
    return COUNTRIES.find(function (country) {
      return (
        normalizeSearchText(country.name) === normalized ||
        normalizeSearchText(country.nameZh) === normalized ||
        normalizeSearchText(country.code) === normalized ||
        formatCountryLabel(country).toLowerCase() === normalized
      );
    }) || null;
  }

  function findCityByInput(countryCode, value) {
    var normalized = normalizeSearchText(value);
    if (!normalized || !countryCode) {
      return null;
    }
    var cities = CITIES_BY_COUNTRY[countryCode] || [];
    return cities.find(function (city) {
      return (
        normalizeSearchText(city.name) === normalized ||
        normalizeSearchText(city.nameZh) === normalized ||
        formatCityLabel(city).toLowerCase() === normalized
      );
    }) || null;
  }

  function searchCountries(query, limit) {
    var maxItems = Number.isFinite(limit) ? limit : 8;
    return COUNTRIES.filter(function (country) {
      return matchSearchText(query, [
        country.name,
        country.nameZh,
        country.code,
        formatCountryLabel(country),
      ]);
    }).slice(0, maxItems);
  }

  function searchCities(countryCode, query, limit) {
    var maxItems = Number.isFinite(limit) ? limit : 8;
    var cities = CITIES_BY_COUNTRY[countryCode] || [];
    if (!countryCode) {
      return [];
    }
    return cities.filter(function (city) {
      return matchSearchText(query, [
        city.name,
        city.nameZh,
        formatCityLabel(city),
      ]);
    }).slice(0, maxItems);
  }

  function getCountryCodeFromInput(value) {
    var country = findCountryByInput(value);
    return country ? country.code : "";
  }

  var exportsObj = {
    COUNTRIES: COUNTRIES,
    CITIES_BY_COUNTRY: CITIES_BY_COUNTRY,
    searchCountries: searchCountries,
    searchCities: searchCities,
    findCountryByInput: findCountryByInput,
    findCityByInput: findCityByInput,
    getCountryCodeFromInput: getCountryCodeFromInput,
    formatCountryLabel: formatCountryLabel,
    formatCityLabel: formatCityLabel,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = exportsObj;
  }
  if (typeof globalScope !== "undefined") {
    globalScope.TravelLocationData = exportsObj;
  }
}(typeof window !== "undefined" ? window : global));
