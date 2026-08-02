(function () {
  "use strict";

  var featureFlags = {
    mapPickEntryEnabled: false,
  };

  var state = {
    places: [],
    llmInsights: {},
    selectedCountryCode: "",
    mapReady: false,
    mapLoading: false,
    map: null,
    geocoder: null,
    directionsService: null,
    routeRenderers: [],
    routeMarkers: [],
    mapPickListener: null,
  };

  var ui = {
    countryInput: document.getElementById("countryInput"),
    cityInput: document.getElementById("cityInput"),
    apiKeyInput: document.getElementById("apiKeyInput"),
    connectMapBtn: document.getElementById("connectMapBtn"),
    placesGridBody: document.getElementById("placesGridBody"),
    addPlaceBtn: document.getElementById("addPlaceBtn"),
    markMapBtn: document.getElementById("markMapBtn"),
    llmBaseUrlInput: document.getElementById("llmBaseUrlInput"),
    llmApiKeyInput: document.getElementById("llmApiKeyInput"),
    llmProviderInput: document.getElementById("llmProviderInput"),
    llmModelSelect: document.getElementById("llmModelSelect"),
    llmModelInput: document.getElementById("llmModelInput"),
    llmAnalyzeBtn: document.getElementById("llmAnalyzeBtn"),
    agentPlanBtn: document.getElementById("agentPlanBtn"),
    daysInput: document.getElementById("daysInput"),
    visitMinutesInput: document.getElementById("visitMinutesInput"),
    statusText: document.getElementById("statusText"),
    placesList: document.getElementById("placesList"),
    itineraryResult: document.getElementById("itineraryResult"),
  };

  var ITINERARY_PLACEHOLDER =
    "<p class=\"itinerary-placeholder\">填写 LLM 配置并点击「Agent 智能规划」后，路书将显示在这里。</p>";

  function getCountryValue() {
    return ui.countryInput.value.trim();
  }

  function getCityValue() {
    return ui.cityInput.value.trim();
  }

  function syncSelectedCountryCode() {
    if (!window.TravelLocationData) {
      state.selectedCountryCode = "";
      return;
    }
    state.selectedCountryCode = window.TravelLocationData.getCountryCodeFromInput(getCountryValue());
  }

  function getCommonTripInput() {
    return {
      country: getCountryValue(),
      city: getCityValue(),
      totalDays: Number(ui.daysInput.value),
      visitMinutes: Number(ui.visitMinutesInput.value),
      places: mergePlacesWithLlmInsights(collectPlacesFromGrid()),
    };
  }

  function pickLlmModelValue() {
    var manualModel = ui.llmModelInput.value.trim();
    if (manualModel) {
      return manualModel;
    }
    var selectedModel = ui.llmModelSelect.value.trim();
    if (!selectedModel) {
      return "";
    }
    return selectedModel;
  }

  function updateModelSelectOptions(models, currentModel) {
    ui.llmModelSelect.innerHTML = "";
    if (!models.length) {
      var emptyOption = document.createElement("option");
      emptyOption.value = "";
      emptyOption.textContent = "请手动输入模型";
      ui.llmModelSelect.appendChild(emptyOption);
      return;
    }

    models.forEach(function (modelName) {
      var option = document.createElement("option");
      option.value = modelName;
      option.textContent = modelName;
      if (currentModel && currentModel === modelName) {
        option.selected = true;
      }
      ui.llmModelSelect.appendChild(option);
    });
  }

  function refreshProviderAndModelByBaseUrl() {
    if (!window.TravelLlm) {
      return;
    }
    var providerInfo = window.TravelLlm.detectProviderByBaseUrl(ui.llmBaseUrlInput.value);
    ui.llmProviderInput.value = providerInfo.provider;

    var models = window.TravelLlm.getProviderModels(providerInfo.provider);
    var currentSelected = pickLlmModelValue();
    updateModelSelectOptions(models, currentSelected);

    if (!ui.llmModelInput.value.trim() && ui.llmModelSelect.value) {
      ui.llmModelInput.value = ui.llmModelSelect.value;
    }
  }

  function updateStatus(text, isError) {
    ui.statusText.textContent = text;
    ui.statusText.style.borderColor = isError ? "#fecaca" : "#bfdbfe";
    ui.statusText.style.background = isError ? "#fef2f2" : "#eff6ff";
  }

  function clearRouteOverlays() {
    state.routeRenderers.forEach(function (renderer) {
      renderer.setMap(null);
    });
    state.routeRenderers = [];

    state.routeMarkers.forEach(function (marker) {
      marker.setMap(null);
    });
    state.routeMarkers = [];
  }

  function createPlaceRow(nameValue, addressValue) {
    var row = document.createElement("div");
    row.className = "places-grid-row";

    var indexCell = document.createElement("span");
    indexCell.className = "col-index place-row-index";

    var nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "place-name-input";
    nameInput.placeholder = "景点名称";
    nameInput.value = nameValue || "";

    var addressInput = document.createElement("input");
    addressInput.type = "text";
    addressInput.className = "place-address-input";
    addressInput.placeholder = "详细地址";
    addressInput.value = addressValue || "";

    var removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "btn-icon";
    removeBtn.textContent = "×";
    removeBtn.title = "删除此行";
    removeBtn.addEventListener("click", function () {
      removePlaceRow(row);
    });

    row.appendChild(indexCell);
    row.appendChild(nameInput);
    row.appendChild(addressInput);
    row.appendChild(removeBtn);
    return row;
  }

  function refreshPlaceRowIndexes() {
    var rows = ui.placesGridBody.querySelectorAll(".places-grid-row");
    rows.forEach(function (row, index) {
      var indexCell = row.querySelector(".place-row-index");
      if (indexCell) {
        indexCell.textContent = String(index + 1);
      }
    });
  }

  function addPlaceRow(nameValue, addressValue) {
    var row = createPlaceRow(nameValue, addressValue);
    ui.placesGridBody.appendChild(row);
    refreshPlaceRowIndexes();
    return row;
  }

  function removePlaceRow(row) {
    var rows = ui.placesGridBody.querySelectorAll(".places-grid-row");
    if (rows.length <= 1) {
      row.querySelector(".place-name-input").value = "";
      row.querySelector(".place-address-input").value = "";
      updateStatus("至少保留一行景点输入。", false);
      return;
    }
    row.remove();
    refreshPlaceRowIndexes();
  }

  function collectPlaceRowsFromGrid() {
    var rows = ui.placesGridBody.querySelectorAll(".places-grid-row");
    return Array.prototype.map.call(rows, function (row) {
      return {
        name: row.querySelector(".place-name-input").value.trim(),
        address: row.querySelector(".place-address-input").value.trim(),
      };
    });
  }

  function collectPlacesFromGrid() {
    var country = getCountryValue();
    var city = getCityValue();
    return window.TravelPlanner.parsePlaceRows(collectPlaceRowsFromGrid(), country, city);
  }

  function appendPlaceToGrid(placeName, placeAddress) {
    var rows = collectPlaceRowsFromGrid();
    var lastRow = rows[rows.length - 1];
    if (lastRow && !lastRow.name && !lastRow.address) {
      var gridRows = ui.placesGridBody.querySelectorAll(".places-grid-row");
      var targetRow = gridRows[gridRows.length - 1];
      targetRow.querySelector(".place-name-input").value = placeName;
      targetRow.querySelector(".place-address-input").value = placeAddress || "";
      return;
    }
    addPlaceRow(placeName, placeAddress || "");
  }

  function bindMapPickEntryHook() {
    if (!state.map || !featureFlags.mapPickEntryEnabled) {
      return;
    }
    if (state.mapPickListener) {
      return;
    }
    state.mapPickListener = state.map.addListener("click", function (event) {
      var lat = event.latLng.lat().toFixed(6);
      var lng = event.latLng.lng().toFixed(6);
      var placeName = "地图选点(" + lat + "," + lng + ")";
      appendPlaceToGrid(placeName, "");
      updateStatus("已通过地图切口追加景点。", false);
    });
  }

  function splitStopsIntoRouteSegments(stops, maxStopsPerSegment) {
    if (!Array.isArray(stops) || stops.length < 2) {
      return [];
    }
    var segments = [];
    var start = 0;
    while (start < stops.length - 1) {
      var end = Math.min(start + maxStopsPerSegment, stops.length);
      segments.push(stops.slice(start, end));
      start = end - 1;
    }
    return segments;
  }

  function geocodePlace(query, countryCode) {
    return new Promise(function (resolve, reject) {
      var request = { address: query };
      if (countryCode) {
        request.componentRestrictions = { country: countryCode.toLowerCase() };
      }

      state.geocoder.geocode(request, function (results, status) {
        if (status !== "OK" || !results || !results[0]) {
          reject(new Error("地理编码失败: " + query + " (" + status + ")"));
          return;
        }
        var first = results[0];
        var location = first.geometry.location;
        resolve({
          latLng: location,
          formattedAddress: first.formatted_address || query,
          lat: location.lat(),
          lng: location.lng(),
        });
      });
    });
  }

  function buildPlaceGeocodeQuery(place, country, city) {
    if (place.geocodeQuery) {
      return place.geocodeQuery;
    }
    return window.TravelPlanner.buildGeocodeQuery(place, country, city);
  }

  function requestDirections(segment) {
    return new Promise(function (resolve, reject) {
      var waypoints = segment.slice(1, -1).map(function (stop) {
        return {
          location: stop.latLng,
          stopover: true,
        };
      });

      state.directionsService.route(
        {
          origin: segment[0].latLng,
          destination: segment[segment.length - 1].latLng,
          waypoints: waypoints,
          optimizeWaypoints: false,
          travelMode: google.maps.TravelMode.DRIVING,
        },
        function (result, status) {
          if (status !== "OK") {
            reject(new Error("路线规划失败: " + status));
            return;
          }
          resolve(result);
        }
      );
    });
  }

  async function resolvePlacesForMap(places, country, city) {
    syncSelectedCountryCode();
    var countryCode = state.selectedCountryCode;
    var resolved = [];
    var i;

    for (i = 0; i < places.length; i += 1) {
      var place = places[i];
      var query = buildPlaceGeocodeQuery(place, country, city);
      var geo = await geocodePlace(query, countryCode);
      resolved.push({
        title: place.name,
        address: place.address,
        query: query,
        formattedAddress: geo.formattedAddress,
        lat: geo.lat,
        lng: geo.lng,
        latLng: geo.latLng,
        sourcePlace: place,
      });
    }
    return resolved;
  }

  async function markOrderedPlacesOnMap() {
    if (!state.mapReady) {
      updateStatus("请先连接 Google 地图。", true);
      return;
    }

    var country = getCountryValue();
    var city = getCityValue();
    var places = collectPlacesFromGrid();

    if (!country) {
      updateStatus("请输入目标国家。", true);
      return;
    }
    if (!city) {
      updateStatus("请输入目标城市。", true);
      return;
    }
    if (!places.length) {
      updateStatus("请至少填写一个景点。", true);
      return;
    }

    state.places = places;
    renderPlacesList();
    updateStatus("正在地理编码并在地图上标点...", false);

    try {
      var resolvedStops = await resolvePlacesForMap(places, country, city);
      clearRouteOverlays();

      resolvedStops.forEach(function (stop, index) {
        if (stop.sourcePlace) {
          stop.sourcePlace.resolvedAddress = stop.formattedAddress;
          stop.sourcePlace.resolvedLat = stop.lat;
          stop.sourcePlace.resolvedLng = stop.lng;
          stop.sourcePlace.location = { lat: stop.lat, lng: stop.lng };
          stop.sourcePlace.geocodeQuery = stop.query;
        }

        var marker = new google.maps.Marker({
          map: state.map,
          position: stop.latLng,
          label: String(index + 1),
          title: stop.title + " - " + stop.formattedAddress,
        });
        state.routeMarkers.push(marker);
      });

      state.places = places;
      renderPlacesList();

      if (resolvedStops.length === 1) {
        state.map.setCenter(resolvedStops[0].latLng);
        state.map.setZoom(14);
      } else {
        var bounds = new google.maps.LatLngBounds();
        resolvedStops.forEach(function (stop) {
          bounds.extend(stop.latLng);
        });
        state.map.fitBounds(bounds);
      }

      updateStatus("已在地图上按顺序标点（共 " + resolvedStops.length + " 个），具体位置见下方解析结果。", false);
    } catch (err) {
      updateStatus("地图标点失败: " + err.message, true);
    }
  }

  async function renderRouteOnMap(planData, country, city) {
    if (!state.mapReady) {
      updateStatus("请先连接 Google 地图。", true);
      return;
    }

    var routeStops = window.TravelPlanner.buildRouteStops(planData);
    if (!routeStops.length) {
      clearRouteOverlays();
      updateStatus("没有可展示的路线点。", true);
      return;
    }

    updateStatus("正在计算路线并渲染地图...", false);

    var resolvedStops = [];
    var i;
    syncSelectedCountryCode();
    var countryCode = state.selectedCountryCode;

    for (i = 0; i < routeStops.length; i += 1) {
      var stop = routeStops[i];
      var query = window.TravelPlanner.buildGeocodeQuery({
        name: stop.title,
        addressExtra: "",
      }, country, city);
      var geo = await geocodePlace(query, countryCode);
      resolvedStops.push({
        title: stop.title,
        day: stop.day,
        startTime: stop.startTime,
        address: stop.address,
        formattedAddress: geo.formattedAddress,
        latLng: geo.latLng,
      });
    }

    clearRouteOverlays();

    resolvedStops.forEach(function (stop, index) {
      var marker = new google.maps.Marker({
        map: state.map,
        position: stop.latLng,
        label: String(index + 1),
        title: "Day " + stop.day + " " + stop.startTime + " " + stop.title,
      });
      state.routeMarkers.push(marker);
    });

    if (resolvedStops.length === 1) {
      state.map.setCenter(resolvedStops[0].latLng);
      state.map.setZoom(14);
      updateStatus("智能规划完成，已展示单点位置。", false);
      return;
    }

    var segments = splitStopsIntoRouteSegments(resolvedStops, 25);
    for (i = 0; i < segments.length; i += 1) {
      var directionsResult = await requestDirections(segments[i]);
      var renderer = new google.maps.DirectionsRenderer({
        map: state.map,
        suppressMarkers: true,
        preserveViewport: i > 0,
        polylineOptions: {
          strokeColor: "#2563eb",
          strokeOpacity: 0.85,
          strokeWeight: 5,
        },
      });
      renderer.setDirections(directionsResult);
      state.routeRenderers.push(renderer);
    }

    var bounds = new google.maps.LatLngBounds();
    resolvedStops.forEach(function (stop) {
      bounds.extend(stop.latLng);
    });
    state.map.fitBounds(bounds);
    updateStatus("智能规划完成，路线已展示在地图上。", false);
  }

  function renderPlacesList() {
    if (!state.places.length) {
      ui.placesList.innerHTML = "<p>暂无景点，请先填写景点列表。</p>";
      return;
    }

    ui.placesList.innerHTML = state.places.map(function (place, index) {
      var durationLabel = place.suggestedDurationMin || place.durationMin;
      var reasonLabel = place.llmReason || "";
      var durationLine = durationLabel ? ("建议停留: " + durationLabel + " 分钟") : "";
      var reasonLine = reasonLabel ? ("<br/>LLM建议: " + escapeHtml(reasonLabel)) : "";
      var queryLine = place.geocodeQuery
        ? ("<br/>查询: " + escapeHtml(place.geocodeQuery))
        : "";
      var locationLine = place.resolvedAddress
        ? ("<br/><strong>具体位置:</strong> " + escapeHtml(place.resolvedAddress))
        : "<br/><span class=\"place-pending\">具体位置: 点击「在地图上标点」后解析</span>";
      var coordLine = Number.isFinite(place.resolvedLat) && Number.isFinite(place.resolvedLng)
        ? ("<br/>坐标: " + place.resolvedLat.toFixed(6) + ", " + place.resolvedLng.toFixed(6))
        : "";

      return (
        "<div class=\"place-item\">" +
        "<span><strong>" + (index + 1) + ". " + escapeHtml(place.name) + "</strong>" +
        locationLine +
        coordLine +
        queryLine +
        (durationLine ? ("<br/>" + escapeHtml(durationLine)) : "") +
        reasonLine +
        "</span></div>"
      );
    }).join("");
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function renderAgentRoadbook(agentResult, country, city) {
    if (!agentResult) {
      ui.itineraryResult.innerHTML = "<p>无路书内容，请检查 LLM 配置后重试。</p>";
      return;
    }

    var sections = [];

    if (agentResult.summary) {
      sections.push(
        "<section class=\"roadbook-section\">" +
        "<h3>行程概述</h3>" +
        "<p>" + escapeHtml(agentResult.summary) + "</p>" +
        "</section>"
      );
    }

    if (agentResult.routeStrategy) {
      sections.push(
        "<section class=\"roadbook-section\">" +
        "<h3>路线策略</h3>" +
        "<p>" + escapeHtml(agentResult.routeStrategy) + "</p>" +
        "</section>"
      );
    }

    var spotlights = Array.isArray(agentResult.placeSpotlights) ? agentResult.placeSpotlights : [];
    if (spotlights.length) {
      var spotlightHtml = spotlights.map(function (item, index) {
        var tipsLine = item.tips
          ? ("<p class=\"roadbook-meta\"><strong>小贴士：</strong>" + escapeHtml(item.tips) + "</p>")
          : "";
        return (
          "<article class=\"spotlight-card\">" +
          "<h4>" + (index + 1) + ". " + escapeHtml(item.name) + "</h4>" +
          "<p>" + escapeHtml(item.introduction || "暂无介绍") + "</p>" +
          (item.highlights ? ("<p class=\"roadbook-meta\"><strong>看点：</strong>" + escapeHtml(item.highlights) + "</p>") : "") +
          (item.suggestedVisitRange ? ("<p class=\"roadbook-meta\"><strong>建议停留：</strong>" + escapeHtml(item.suggestedVisitRange) + "</p>") : "") +
          tipsLine +
          "</article>"
        );
      }).join("");
      sections.push(
        "<section class=\"roadbook-section\">" +
        "<h3>景点速览</h3>" +
        spotlightHtml +
        "</section>"
      );
    }

    var roadbook = Array.isArray(agentResult.roadbook) ? agentResult.roadbook : [];
    if (roadbook.length) {
      var stepsHtml = roadbook.map(function (step) {
        var travel = step.travelToNext;
        var travelHtml = "";
        if (travel && travel.destination) {
          travelHtml =
            "<div class=\"roadbook-transit\">" +
            "<strong>前往下一站 " + escapeHtml(travel.destination) + "</strong>" +
            (travel.durationRange ? ("<p>路程：" + escapeHtml(travel.durationRange) + "</p>") : "") +
            (travel.distanceText ? ("<p>距离：" + escapeHtml(travel.distanceText) + "</p>") : "") +
            (travel.note ? ("<p class=\"roadbook-note\">" + escapeHtml(travel.note) + "</p>") : "") +
            "</div>";
        }
        return (
          "<article class=\"roadbook-step\">" +
          "<h4>第 " + step.step + " 站 · " + escapeHtml(step.placeName) + "</h4>" +
          (step.visitTimeRange ? ("<p><strong>游玩时间：</strong>" + escapeHtml(step.visitTimeRange) + "</p>") : "") +
          (step.visitTips ? ("<p class=\"roadbook-note\">" + escapeHtml(step.visitTips) + "</p>") : "") +
          travelHtml +
          "</article>"
        );
      }).join("");
      sections.push(
        "<section class=\"roadbook-section\">" +
        "<h3>推荐游览路书 · " + escapeHtml(city) + ", " + escapeHtml(country) + "</h3>" +
        stepsHtml +
        "</section>"
      );
    }

    var precautions = Array.isArray(agentResult.precautions) ? agentResult.precautions : [];
    if (precautions.length) {
      sections.push(
        "<section class=\"roadbook-section roadbook-precautions\">" +
        "<h3>注意事项</h3>" +
        "<ul>" +
        precautions.map(function (item) {
          return "<li>" + escapeHtml(item) + "</li>";
        }).join("") +
        "</ul>" +
        "</section>"
      );
    }

    if (!sections.length) {
      ui.itineraryResult.innerHTML = "<p>模型未返回有效路书，请重试或检查 API 配置。</p>";
      return;
    }

    ui.itineraryResult.innerHTML = sections.join("");
  }

  function resetItineraryPanel() {
    ui.itineraryResult.innerHTML = ITINERARY_PLACEHOLDER;
  }

  function mergePlacesWithLlmInsights(places) {
    var llmModule = window.TravelLlm;
    if (!llmModule || typeof llmModule.normalizeName !== "function") {
      return places;
    }
    return places.map(function (place) {
      var normalizedName = llmModule.normalizeName(place.name);
      var insight = state.llmInsights[normalizedName];
      if (!insight) {
        return place;
      }

      var nextPlace = Object.assign({}, place);
      if (!nextPlace.durationMin) {
        nextPlace.suggestedDurationMin = insight.suggestedDurationMin;
      }
      if (Number.isFinite(insight.score)) {
        nextPlace.score = insight.score;
      }
      nextPlace.llmReason = insight.reason;
      nextPlace.llmPriority = insight.priority;
      return nextPlace;
    });
  }

  async function analyzePlacesWithLlm() {
    if (!window.TravelLlm) {
      updateStatus("LLM 模块未加载，请刷新页面。", true);
      return;
    }

    var country = getCountryValue();
    var city = getCityValue();
    var totalDays = Number(ui.daysInput.value);
    var rawPlaces = collectPlacesFromGrid();
    var baseUrl = ui.llmBaseUrlInput.value.trim();
    var apiKey = ui.llmApiKeyInput.value.trim();
    var model = pickLlmModelValue();

    if (!country || !city) {
      updateStatus("请先填写目标国家和城市。", true);
      return;
    }
    if (!rawPlaces.length) {
      updateStatus("请先填写景点后再做 LLM 分析。", true);
      return;
    }
    if (!baseUrl || !apiKey || !model) {
      updateStatus("请填写 LLM Base URL、API Key 和 Model。", true);
      return;
    }

    updateStatus("正在调用 LLM 分析景点时长与优先级...", false);
    try {
      var prompt = window.TravelLlm.buildPlaceAnalysisPrompt({
        country: country,
        city: city,
        totalDays: totalDays,
        places: rawPlaces,
      });

      var response = await fetch(baseUrl.replace(/\/$/, "") + "/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + apiKey,
        },
        body: JSON.stringify({
          model: model,
          temperature: 0.2,
          messages: [
            { role: "system", content: "你是专业旅行规划助手。" },
            { role: "user", content: prompt },
          ],
        }),
      });

      if (!response.ok) {
        var errText = await response.text();
        throw new Error("LLM 请求失败(" + response.status + "): " + errText);
      }

      var data = await response.json();
      var content = (((data || {}).choices || [])[0] || {}).message;
      var answerText = content ? content.content : "";
      if (Array.isArray(answerText)) {
        answerText = answerText.map(function (part) {
          if (typeof part === "string") {
            return part;
          }
          return part && part.text ? part.text : "";
        }).join("\n");
      }
      if (!answerText) {
        throw new Error("LLM 返回内容为空");
      }

      var analysis = window.TravelLlm.parseAnalysisJson(answerText);
      state.llmInsights = window.TravelLlm.toInsightMap(analysis.places);
      state.places = mergePlacesWithLlmInsights(rawPlaces);
      renderPlacesList();
      updateStatus("LLM 分析完成，可继续点击 Agent 智能规划。", false);
    } catch (err) {
      updateStatus("LLM 分析失败: " + err.message, true);
    }
  }

  async function agentPlanWithTools() {
    var tripInput = getCommonTripInput();
    var country = tripInput.country;
    var city = tripInput.city;
    var totalDays = tripInput.totalDays;
    var visitMinutes = tripInput.visitMinutes;
    var places = tripInput.places;
    var mapsApiKey = ui.apiKeyInput.value.trim();
    var llmBaseUrl = ui.llmBaseUrlInput.value.trim();
    var llmApiKey = ui.llmApiKeyInput.value.trim();
    var llmModel = pickLlmModelValue();

    if (!country || !city) {
      updateStatus("请先填写目标国家和城市。", true);
      return;
    }
    if (!Number.isFinite(totalDays) || totalDays <= 0) {
      updateStatus("游玩天数必须是正整数。", true);
      return;
    }
    if (!places.length) {
      updateStatus("请先填写景点列表。", true);
      return;
    }
    if (!mapsApiKey) {
      updateStatus("Agent 工具调用需要 Google Maps API Key。", true);
      return;
    }
    if (!llmBaseUrl || !llmApiKey || !llmModel) {
      updateStatus("Agent 规划需要完整 LLM 配置。", true);
      return;
    }

    updateStatus("正在进行 Agent 智能规划（LLM + Google Maps工具）...", false);
    try {
      var response = await fetch("/api/agent/plan", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          country: country,
          city: city,
          totalDays: totalDays,
          visitMinutes: visitMinutes,
          places: places,
          llmBaseUrl: llmBaseUrl,
          llmApiKey: llmApiKey,
          llmModel: llmModel,
          mapsApiKey: mapsApiKey,
        }),
      });

      if (!response.ok) {
        var errText = await response.text();
        throw new Error("Agent 规划失败(" + response.status + "): " + errText);
      }

      var data = await response.json();
      var planData = Array.isArray(data.planData) ? data.planData : [];
      state.places = Array.isArray(data.enrichedPlaces) ? data.enrichedPlaces : places;
      renderPlacesList();
      renderAgentRoadbook({
        summary: data.summary,
        routeStrategy: data.routeStrategy,
        placeSpotlights: data.placeSpotlights,
        roadbook: data.roadbook,
        precautions: data.precautions,
      }, country, city);
      if (state.mapReady) {
        await renderRouteOnMap(planData, country, city);
        updateStatus("智能路书已生成，地图路线已按推荐顺序展示。", false);
      } else {
        updateStatus("智能路书已生成；连接地图后可展示推荐路线。", false);
      }
    } catch (err) {
      updateStatus("Agent 智能规划失败: " + err.message, true);
    }
  }

  function connectGoogleMap() {
    var apiKey = ui.apiKeyInput.value.trim();
    if (!apiKey) {
      updateStatus("请先输入 Google Maps API Key。", true);
      return;
    }
    if (state.mapReady) {
      updateStatus("地图已连接。", false);
      return;
    }
    if (state.mapLoading) {
      updateStatus("地图正在连接，请稍候。", false);
      return;
    }

    state.mapLoading = true;
    window.__travelMapInit = function () {
      state.map = new google.maps.Map(document.getElementById("map"), {
        center: { lat: 48.8566, lng: 2.3522 },
        zoom: 12,
      });
      state.geocoder = new google.maps.Geocoder();
      state.directionsService = new google.maps.DirectionsService();
      state.mapReady = true;
      state.mapLoading = false;
      bindMapPickEntryHook();
      updateStatus("Google 地图连接成功，可点击「在地图上标点」。", false);
    };

    var script = document.createElement("script");
    script.src = "https://maps.googleapis.com/maps/api/js?key=" +
      encodeURIComponent(apiKey) +
      "&callback=__travelMapInit";
    script.async = true;
    script.defer = true;
    script.onerror = function () {
      state.mapLoading = false;
      updateStatus("Google 地图加载失败，请检查 API Key 和网络。", true);
    };
    document.head.appendChild(script);
    updateStatus("正在连接 Google 地图...", false);
  }

  function refreshPlacesPreview() {
    var places = collectPlacesFromGrid();
    if (!places.length) {
      state.places = [];
      ui.placesList.innerHTML = "<p>暂无景点，请先填写景点列表。</p>";
      return;
    }
    state.places = places;
    renderPlacesList();
  }

  function attachEventHandlers() {
    ui.connectMapBtn.addEventListener("click", connectGoogleMap);
    ui.addPlaceBtn.addEventListener("click", function () {
      addPlaceRow("", "");
    });
    ui.markMapBtn.addEventListener("click", function () {
      markOrderedPlacesOnMap();
    });
    ui.llmBaseUrlInput.addEventListener("change", refreshProviderAndModelByBaseUrl);
    ui.llmModelSelect.addEventListener("change", function () {
      if (ui.llmModelSelect.value) {
        ui.llmModelInput.value = ui.llmModelSelect.value;
      }
    });
    ui.llmAnalyzeBtn.addEventListener("click", function () {
      analyzePlacesWithLlm();
    });
    ui.agentPlanBtn.addEventListener("click", function () {
      agentPlanWithTools();
    });
    ui.placesGridBody.addEventListener("input", refreshPlacesPreview);
    ui.countryInput.addEventListener("change", syncSelectedCountryCode);
  }

  function initPlacesGrid() {
    addPlaceRow("", "");
  }

  initPlacesGrid();
  resetItineraryPanel();
  refreshPlacesPreview();
  syncSelectedCountryCode();
  refreshProviderAndModelByBaseUrl();
  attachEventHandlers();
}());
