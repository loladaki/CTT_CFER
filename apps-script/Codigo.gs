/**
 * CTT_CFER — Seguimento automático de encomendas dos CTT (Google Apps Script)
 * -------------------------------------------------------------------------
 * O que faz:
 *   - Lês/escreves os números de objeto na folha "Encomendas".
 *   - Todos os dias (ou ao carregar no menu) vai ao site dos CTT buscar o
 *     estado de cada um, atualiza a linha e guarda o histórico na folha
 *     "Histórico".
 *   - As cores destacam automaticamente: Devolvido (vermelho), Entregue
 *     (verde), Em entrega/distribuição (azul), etc.
 *
 * Como pôr a funcionar (1ª vez):
 *   1) Cola este ficheiro no editor de Apps Script da tua Google Sheet.
 *   2) Guarda. Recarrega a folha de cálculo (F5).
 *   3) No menu novo "CTT" → "Configurar (1ª vez)".
 *   4) Escreve números de objeto na coluna A da folha "Encomendas".
 *   5) Menu "CTT" → "Atualizar agora" (autoriza quando pedir).
 *   6) Menu "CTT" → "Ativar atualização diária".
 *
 * Se um dia deixar de atualizar (os CTT mudaram a app), vê a nota
 * "APROVEITAR / ATUALIZAR A apiVersion" no fim do ficheiro.
 */

// ======================= CONFIGURAÇÃO =======================
// Muda MUITO raramente (só quando os CTT atualizam a app). Instruções no fim.
const API_VERSION = "1XlpsnjiL6DjE9aTOfOjzA";

const BASE     = "https://appserver.ctt.pt/CustomerArea/";
const VERINFO  = BASE + "moduleservices/moduleversioninfo";
const ENDPOINT = BASE + "screenservices/CustomerArea/CustomerArea/PublicArea_Detail/DataActionGetObjectEventsByInputObjectCode";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const TZ = "Europe/Lisbon";

const FOLHA_ENC = "Encomendas";
const FOLHA_HIST = "Histórico";
const FOLHA_PAINEL = "Painel";

// Horas (0-23) a que a atualização automática corre. Ex.: [13, 20] = 2x/dia.
// Para 1x/dia usa [20]; para 3x usa [9, 14, 20]. Depois de mudar, volta a
// clicar no menu "CTT → Ativar atualização diária".
const HORAS_ATUALIZACAO = [13, 20];

// ======================= MENU =======================
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("CTT")
    .addItem("Atualizar agora", "atualizarEncomendas")
    .addItem("Abrir dashboard (link)", "mostrarLinkDashboard")
    .addSeparator()
    .addItem("Configurar (1ª vez)", "configurar")
    .addItem("Ativar atualização diária", "ativarDiario")
    .addItem("Desativar atualização diária", "desativarDiario")
    .addToUi();
}

// Mostra o link da aplicação web (dashboard), depois de publicada.
function mostrarLinkDashboard() {
  const url = ScriptApp.getService().getUrl();
  const ui = SpreadsheetApp.getUi();
  if (!url) {
    ui.alert("Dashboard ainda não publicado.\n\nNo editor do Apps Script: Implementar → Nova implementação → Aplicação Web → (Executar como: eu; Quem tem acesso: à tua escolha) → Implementar. Depois volta a clicar aqui.");
  } else {
    ui.alert("Link do dashboard:\n\n" + url + "\n\nAbre-o no browser e partilha com a equipa.");
  }
}

// ======================= CONFIGURAÇÃO INICIAL =======================
function configurar() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // --- Folha "Encomendas" ---
  let enc = ss.getSheetByName(FOLHA_ENC) || ss.insertSheet(FOLHA_ENC, 0);
  const cabec = ["Nº Objeto", "Descrição", "Estado", "Situação (último evento)",
                 "Local", "Progresso", "Data do evento", "Verificado em", "Encontrado", "Seguimento", "Fecho manual"];
  enc.getRange(1, 1, 1, cabec.length).setValues([cabec])
     .setFontWeight("bold").setBackground("#c8102e").setFontColor("#ffffff");
  enc.setFrozenRows(1);
  enc.setColumnWidth(1, 150); enc.setColumnWidth(2, 200);
  enc.setColumnWidth(3, 140); enc.setColumnWidth(4, 320);
  enc.setColumnWidth(5, 180); enc.setColumnWidth(7, 150); enc.setColumnWidth(8, 150);
  enc.setColumnWidth(10, 170); enc.setColumnWidth(11, 140);
  enc.getRange("F2:F1000").setNumberFormat('0"%"'); // Progresso: guarda 0-100, mostra "80%"
  // Coluna K "Fecho manual": menu Automático / Fechada
  const dv = SpreadsheetApp.newDataValidation()
    .requireValueInList(["Automático", "Fechada"], true).setAllowInvalid(true).build();
  enc.getRange("K2:K1000").setDataValidation(dv);
  aplicarCores(enc);

  // --- Folha "Histórico" ---
  let hist = ss.getSheetByName(FOLHA_HIST) || ss.insertSheet(FOLHA_HIST);
  hist.getRange(1, 1, 1, 5).setValues([["Nº Objeto", "Data/Hora", "Estado", "Evento", "Local"]])
      .setFontWeight("bold").setBackground("#333333").setFontColor("#ffffff");
  hist.setFrozenRows(1);
  hist.setColumnWidth(1, 150); hist.setColumnWidth(2, 150);
  hist.setColumnWidth(3, 140); hist.setColumnWidth(4, 380); hist.setColumnWidth(5, 200);

  // --- Folha "Painel" (KPIs) ---
  let pain = ss.getSheetByName(FOLHA_PAINEL) || ss.insertSheet(FOLHA_PAINEL, 0);
  pain.clear();
  const col = "'" + FOLHA_ENC + "'!C2:C";
  const colJ = "'" + FOLHA_ENC + "'!J2:J";
  const kpis = [
    ["Painel de Encomendas CTT", ""],
    ["Total", '=COUNTA(' + "'" + FOLHA_ENC + "'!A2:A)"],
    ["Em seguimento (ativas)", '=COUNTIF(' + colJ + ',"*Ativa*")'],
    ["Fechadas", '=COUNTIF(' + colJ + ',"*Fechada*")'],
    ["Devolvidas", '=COUNTIF(' + col + ',"*Devolv*")'],
    ["Entregues", '=COUNTIF(' + col + ',"*Entregue*")'],
    ["Em entrega/distribuição", '=COUNTIF(' + col + ',"*entrega*")+COUNTIF(' + col + ',"*distribui*")'],
    ["A aguardar levantamento", '=COUNTIF(' + col + ',"*levantamento*")'],
    ["Em trânsito", '=COUNTIF(' + col + ',"*trânsito*")+COUNTIF(' + col + ',"*transito*")'],
    ["Problemas/erros", '=COUNTIF(' + col + ',"*⚠*")'],
  ];
  pain.getRange(1, 1, kpis.length, 2).setValues(kpis);
  pain.getRange(1, 1, 1, 2).merge().setFontWeight("bold").setFontSize(14)
      .setBackground("#c8102e").setFontColor("#ffffff");
  pain.getRange(2, 1, kpis.length - 1, 1).setFontWeight("bold");
  pain.getRange(5, 2).setFontColor("#b42318").setFontWeight("bold"); // devolvidas
  pain.setColumnWidth(1, 220); pain.setColumnWidth(2, 100);

  SpreadsheetApp.getUi().alert("Configuração concluída ✅\n\nEscreve números de objeto na coluna A da folha \"Encomendas\" e depois usa o menu CTT → Atualizar agora.");
}

function aplicarCores(enc) {
  // Cores condicionais na coluna C (Estado)
  const range = enc.getRange("C2:C1000");
  const cor = function (txt, bg, fg) {
    return SpreadsheetApp.newConditionalFormatRule()
      .whenTextContains(txt).setBackground(bg).setFontColor(fg || "#ffffff")
      .setRanges([range]).build();
  };
  const regras = [
    cor("Devolv", "#b42318"),        // vermelho
    cor("Entregue", "#1a7f37"),      // verde
    cor("Em entrega", "#7a3fd6"),    // roxo
    cor("distribui", "#7a3fd6"),
    cor("levantamento", "#8a5a00"),  // amarelo escuro
    cor("Tentativa", "#bc4c00"),     // laranja
    cor("insucesso", "#bc4c00"),
    cor("trânsito", "#1f6feb"),      // azul
    cor("transito", "#1f6feb"),
    cor("Aceite", "#57606a"),        // cinzento
    cor("Registad", "#57606a"),
    cor("⚠", "#b42318"),
  ];
  enc.setConditionalFormatRules(regras);
}

// ======================= ROBÔ PRINCIPAL =======================
function atualizarEncomendas() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const enc = ss.getSheetByName(FOLHA_ENC);
  if (!enc) { configurar(); return; }
  const hist = ss.getSheetByName(FOLHA_HIST);

  const ultima = enc.getLastRow();
  if (ultima < 2) { SpreadsheetApp.getActiveSpreadsheet().toast("Não há números na coluna A."); return; }

  const codigos = enc.getRange(2, 1, ultima - 1, 1).getValues();
  const estados = enc.getRange(2, 3, ultima - 1, 1).getValues(); // coluna C: estado atual (lido de uma vez)
  const manuais = enc.getRange(2, 11, ultima - 1, 1).getValues(); // coluna K: fecho manual
  const sess = abrirSessao();
  if (!sess) { enc.getRange(2, 3).setValue("⚠ Sem ligação aos CTT"); return; }

  // Histórico já existente (para não duplicar)
  const jaExiste = {};
  if (hist && hist.getLastRow() > 1) {
    hist.getRange(2, 1, hist.getLastRow() - 1, 4).getValues().forEach(function (r) {
      jaExiste[r[0] + "|" + r[1] + "|" + r[3]] = true;
    });
  }
  const novosHist = [];
  let consultadas = 0, ignoradas = 0;

  for (let i = 0; i < codigos.length; i++) {
    const code = String(codigos[i][0] || "").trim().toUpperCase();
    const linha = i + 2;
    if (!code) continue;

    // --- OVERRIDE MANUAL --------------------------------------------------
    // Se marcaste "Fechada" (coluna K ou botão do dashboard), o robô não
    // consulta os CTT para esta encomenda — útil quando já chegou mas o site
    // dos CTT ainda mostra "Em trânsito".
    const manual = String(manuais[i][0] || "").trim().toLowerCase();
    if (manual.indexOf("fechad") > -1) {
      enc.getRange(linha, 10).setValue("🔒 Fechada (manual)");
      ignoradas++;
      continue;
    }

    // --- Lógica ATIVA / FECHADA (automática) ------------------------------
    // Encomendas num estado FINAL (Entregue / Devolvido) deixam de ser
    // consultadas: pomos a etiqueta na coluna "Seguimento" e saltamos.
    // (Volta a ficar ativa se apagares a célula do Estado, coluna C.)
    const fimAtual = estadoFinal(estados[i][0]);
    if (fimAtual) {
      enc.getRange(linha, 10).setValue(etiquetaFechada(fimAtual));
      ignoradas++;
      continue;
    }

    // Só chega aqui quem está ATIVA → vamos consultar os CTT.
    consultadas++;
    if (consultadas > 1) Utilities.sleep(400); // pausa só ENTRE pedidos (nunca depois do último)

    let res;
    try { res = consultar(code, sess); }
    catch (e) {
      enc.getRange(linha, 3, 1, 6).setValues([["⚠ Erro", String(e), "", "", "", agora()]]);
      enc.getRange(linha, 10).setValue("🟡 Ativa (repete)");
      continue;
    }

    if (res.versaoMudou) {
      enc.getRange(linha, 3).setValue("⚠ Atualizar API_VERSION (ver guia)");
      enc.getRange(linha, 10).setValue("🟡 Ativa (repete)");
      continue;
    }
    if (!res.found) {
      enc.getRange(linha, 3, 1, 6).setValues([["Sem informação", "Objeto ainda não registado ou inexistente", "", "", "", agora()]]);
      enc.getRange(linha, 9).setValue("Não");
      enc.getRange(linha, 10).setValue("🟡 Ativa");
      continue;
    }

    const ev = res.events[0] || {};
    const dataEv = ev.DateTime ? Utilities.formatDate(new Date(ev.DateTime), TZ, "dd/MM/yyyy HH:mm") : "";
    const prog = (ev.Progress != null) ? Number(ev.Progress) : ""; // 0-100 (número); a coluna mostra "%"
    enc.getRange(linha, 3, 1, 6).setValues([[ ev.State || "", ev.Event || "", ev.Local || "", prog, dataEv, agora() ]]);
    enc.getRange(linha, 9).setValue("Sim");

    // Seguimento: fechada se o novo estado for final, senão ativa.
    const fimNovo = estadoFinal(ev.State);
    enc.getRange(linha, 10).setValue(fimNovo ? etiquetaFechada(fimNovo) : "🟡 Ativa");

    // Acrescenta eventos novos ao histórico (do mais antigo para o mais recente)
    if (hist) {
      res.events.slice().reverse().forEach(function (e) {
        const d = e.DateTime ? Utilities.formatDate(new Date(e.DateTime), TZ, "dd/MM/yyyy HH:mm") : "";
        const chave = code + "|" + d + "|" + (e.Event || "");
        if (!jaExiste[chave]) {
          jaExiste[chave] = true;
          novosHist.push([code, d, e.State || "", e.Event || "", e.Local || ""]);
        }
      });
    }
  }

  if (hist && novosHist.length) {
    hist.getRange(hist.getLastRow() + 1, 1, novosHist.length, 5).setValues(novosHist);
  }
  ss.toast("Atualização concluída ✅  " + consultadas + " consultada(s), " +
           ignoradas + " já finalizada(s) (ignorada(s)).", "CTT", 6);
}

function agora() { return Utilities.formatDate(new Date(), TZ, "dd/MM/yyyy HH:mm"); }

// Devolve "entregue"/"devolvido" se o estado for FINAL; senão null.
// Usa "começa por" para não apanhar estados intermédios ("Em entrega",
// "Em devolução" continuam a ser seguidos até fecharem mesmo).
function estadoFinal(txt) {
  const s = String(txt || "").trim().toLowerCase();
  if (s.indexOf("entregue") === 0) return "entregue";
  if (s.indexOf("devolvid") === 0) return "devolvido"; // devolvido / devolvida
  return null;
}
function etiquetaFechada(tipo) {
  return tipo === "entregue" ? "🟢 Fechada (entregue)" : "🔴 Fechada (devolvido)";
}

// ======================= LIGAÇÃO AOS CTT =======================
function abrirSessao() {
  const jar = {};
  try {
    const rv = UrlFetchApp.fetch(VERINFO, { method: "get", muteHttpExceptions: true, headers: { "User-Agent": UA } });
    apanharCookies(rv, jar);
    const moduleVersion = JSON.parse(rv.getContentText()).versionToken;

    // GET da página para obter o cookie da Cloudflare (__cf_bm)
    const rp = UrlFetchApp.fetch(BASE + "PublicArea_Detail", { method: "get", muteHttpExceptions: true, headers: { "User-Agent": UA } });
    apanharCookies(rp, jar);

    // POST "de arranque" para o servidor devolver o cookie com o token CSRF
    const r = postCTT("AA000000000PT", jar, moduleVersion, null);
    apanharCookies(r, jar);
    const token = lerCsrf(jar);

    return { jar: jar, moduleVersion: moduleVersion, csrf: token };
  } catch (e) {
    Logger.log("abrirSessao erro: " + e);
    return null;
  }
}

function consultar(code, sess) {
  let r = postCTT(code, sess.jar, sess.moduleVersion, sess.csrf);
  // Se o token expirou a meio, tenta renovar uma vez
  if (r.getResponseCode() === 403) {
    apanharCookies(r, sess.jar);
    sess.csrf = lerCsrf(sess.jar) || sess.csrf;
    r = postCTT(code, sess.jar, sess.moduleVersion, sess.csrf);
  }
  const code2 = r.getResponseCode();
  const txt = r.getContentText();

  if (code2 === 409 || /hasApiVersionChanged":true|hasModuleVersionChanged":true/.test(txt)) {
    return { versaoMudou: true };
  }
  if (code2 !== 200) throw new Error("HTTP " + code2);

  const j = JSON.parse(txt);
  const oe = j.data && (j.data.ObjectEventsFromQuery || j.data.ObjectEvents);
  if (!oe) return { found: false, events: [] };
  const list = (oe.Events && oe.Events.List) || [];
  return { found: !!oe.Found && list.length > 0, events: list };
}

function postCTT(code, jar, moduleVersion, token) {
  const headers = {
    "User-Agent": UA, "Accept": "application/json", "Accept-Language": "pt-PT,pt;q=0.9",
    "Origin": "https://appserver.ctt.pt",
    "Referer": BASE + "PublicArea_Detail?ObjectCodeInput=" + code + "&SearchInput=" + code,
    "Cookie": cookiesStr(jar)
  };
  if (token) headers["X-CSRFToken"] = token;
  return UrlFetchApp.fetch(ENDPOINT, {
    method: "post", contentType: "application/json; charset=UTF-8",
    muteHttpExceptions: true, headers: headers, payload: corpo(code, moduleVersion)
  });
}

// ---- cookies / csrf ----
function apanharCookies(resp, jar) {
  try {
    const h = resp.getAllHeaders() || {};
    let sc = h["Set-Cookie"] || h["set-cookie"] || [];
    if (typeof sc === "string") sc = [sc];
    sc.forEach(function (c) {
      const kv = String(c).split(";")[0], eq = kv.indexOf("=");
      if (eq > 0) jar[kv.substring(0, eq)] = kv.substring(eq + 1);
    });
  } catch (e) {}
}
function cookiesStr(jar) { return Object.keys(jar).map(function (k) { return k + "=" + jar[k]; }).join("; "); }
function lerCsrf(jar) {
  let v = jar["nr2Users"]; if (!v) return null;
  try { v = decodeURIComponent(v); } catch (e) {}
  const m = v.match(/crf=([^;]+)/); return m ? m[1] : null;
}

// ---- corpo do pedido (estrutura que a app OutSystems dos CTT espera) ----
function corpo(code, moduleVersion) {
  const ev = { DateTime: "1900-01-01T00:00:00", DateMonthText: "", State: "", StateId: 0, Event: "", EventCode: "", EventColorType: 0, Local: "", Situation: "", Reason: "", Progress: 0, PointCode: "", ReceptorName: "", LockerName: "", WithdrawalDate: "1900-01-01", WithdrawalDateMonthText: "", TypeOfTimelineEvent: 0, Nexus: "" };
  const body = {
    versionInfo: { moduleVersion: moduleVersion, apiVersion: API_VERSION },
    viewName: "CustomerArea.PublicArea_Detail",
    screenData: {
      variables: {
        ObjectEvents: {
          ObjectCode: "", ObjectImageURL: "", ObjectSenderImageUrl: "", ObjectSenderImageUrlSmall: "", RelabelObjectCode: "", ObjectName: "", IsTracked: false, Found: false, CustomsPurposes: false, Sender: "", SenderEmail: "", SenderCountryCode: "", Recipient: "", RecipientEmail: "", RecipientCountryCode: "", RecipientAddress: "", RecipientPostalCodeAndTown: "", RecipientTimeSlot: "", UserEmailMatch: false, UserSenderMatch: false, UserPhoneMatches: false, IsLocker: false, LockerName: "", IsDeliveryPoint: false, CreationDate: "1900-01-01T00:00:00", ClearanceDate: "1900-01-01T00:00:00", DeliveryTimeSlot: "", DeliveryDeadlineEnd: "1900-01-01T00:00:00", DeliveryDeadlineDayAndMonthForStories: "", CTTObject: false, Carrier: "0", CarrierID: 0, CarrierLogoURL: "", ContractNumber: "", ClientNumber: "", FollowObject_Status: 0, ClientContractCompanyName: "", SenderLogo: "0", IsOpenStory: false, ShipmentProduct: "", ClientReference: "", IsB2C: false, SenderMobile: "", ObjectNexus: "FALSE",
          Events: { List: [], EmptyListItem: ev },
          SpecialServices: { List: [], EmptyListItem: { Description: "", Value: "", SepId: "", IsPaymentOnDestination: false } },
          JoinedDeliveries: { JoinedDeliveryId: "", IsPrincipalCode: false },
          RelatedObjects: { List: [], EmptyListItem: { backObjectId: "", ers: "", originalBackObjectId: "", originalErsnObj: "", originalReturnObjectId: "", return: "", originalReturnObjectd: "" } }
        },
        IsPopupVisible: false, PopupObjectNumber: "", PopupObjectName: "", IsTracked: false, ShowS10Code: false, IsClickedLocal: false, ObjectsLength: -1, ShowMenu: false, DisableButton: false, DisableButton_Save: false,
        BreadCrumbPathTemporary: { List: [], EmptyListItem: 0 }, BreadCrumbPath: { List: [], EmptyListItem: 0 },
        ObjectCreationDate: "1900-01-01T00:00:00", IsFromHistory: false, IsResizingListenerRunning: false, HasAssociatedObjects: false, UnfollowAllClicked: false, IsAddedToHistory: false, DisableEditNameIcon: false, WindowWidth: 1209,
        InputVar: code, ObjectsToSearch: code, LoadingPageDone: false, HideWhileOnReadyIsCharging: true, HasBackServices: false, IsToShowInstallBanner: false, StoreName: "", IsToHideProofOfDelivery: false, IPClient: "",
        ObjectCodeInput: code, _objectCodeInputInDataFetchStatus: 1, SearchInput: code, _searchInputInDataFetchStatus: 1, IsFromPublicArea: false, _isFromPublicAreaInDataFetchStatus: 1
      },
      clientVariables: { ClientDomain: "", BreadcrumbTableId_CSV: "", NewAddressId: "0", IsNewAddress: false, LastURL: "", MailBox_FM_IsSuccess: true, MoneyTransactionForTollsPayment: "0", PostMessageToLogin: false, ShowUndoToastMessage: false, AddressId: "0", MailBox_SelectedMailDetail: "", DeletedLockerId: "0", ManagingEntities_FM_IsSuccess: true, IsUserCard: false, MailBox_FM_ErrorMessage: "", ShowPaymentToastMessage: false, EntityDetail_FM_IsSuccess: true, ManagingEntities_FM_ErrorMessage: "", RefreshCounter: 0, AddingLockerId: "0", PaymentMethodId: 0, ClientVarGoToDetail_CA: "", LicensePlateForProcessing: "", Username: "", ObjectDetail: "", IsDeletingAddress: false, ViaCTT_ShareEntitiesActiveTab: 0, MailBox_SelectedMailId: "", ViaCTT_SelectedCategoryId: "", EntityDetail_FM_ErrorMessage: "", SubstituteLockerId: "0", ViaCTT_SelectedEntityId: "", ViaCTT_SelectedCategoryName: "", SelectedAmountToCharge: "0", MailBox_ActiveTab: 0, RequestedMoneyTransactionInternalRef: "0", ViaCTT_SelectedEntityName: "" }
    }
  };
  return JSON.stringify(body);
}

// ======================= GATILHO DIÁRIO =======================
function ativarDiario() {
  desativarDiario();
  HORAS_ATUALIZACAO.forEach(function (h) {
    ScriptApp.newTrigger("atualizarEncomendas").timeBased().everyDays(1).atHour(h).create();
  });
  SpreadsheetApp.getUi().alert("Atualização automática ativada ✅\n\nCorre todos os dias por volta das "
    + HORAS_ATUALIZACAO.join("h e ") + "h.");
}
function desativarDiario() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "atualizarEncomendas") ScriptApp.deleteTrigger(t);
  });
}

// ======================= DASHBOARD (APLICAÇÃO WEB) =======================
// Publica em: Implementar → Nova implementação → Aplicação Web.
function doGet() {
  return HtmlService.createHtmlOutputFromFile("Index")
    .setTitle("CTT · Seguimento de Encomendas")
    .addMetaTag("viewport", "width=device-width, initial-scale=1")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// Chamada pelo dashboard (google.script.run) para obter os dados da folha.
function obterDados() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const enc = ss.getSheetByName(FOLHA_ENC);
  const hist = ss.getSheetByName(FOLHA_HIST);
  const parcels = [];

  if (enc && enc.getLastRow() > 1) {
    const vals = enc.getRange(2, 1, enc.getLastRow() - 1, 11).getValues();

    // Histórico agrupado por código
    const histPorCodigo = {};
    if (hist && hist.getLastRow() > 1) {
      hist.getRange(2, 1, hist.getLastRow() - 1, 5).getValues().forEach(function (r) {
        const c = String(r[0] || "").toUpperCase();
        if (!c) return;
        (histPorCodigo[c] = histPorCodigo[c] || []).push({
          data: String(r[1] || ""), estado: String(r[2] || ""),
          evento: String(r[3] || ""), local: String(r[4] || "")
        });
      });
    }

    vals.forEach(function (r) {
      const code = String(r[0] || "").trim();
      if (!code) return;
      parcels.push({
        code: code,
        descricao: String(r[1] || ""),
        estado: String(r[2] || ""),
        situacao: String(r[3] || ""),
        local: String(r[4] || ""),
        progresso: (r[5] !== "" && r[5] != null) ? String(r[5]) : "",
        dataEvento: String(r[6] || ""),
        verificado: String(r[7] || ""),
        encontrado: String(r[8] || ""),
        seguimento: String(r[9] || ""),
        manual: String(r[10] || ""),
        historico: (histPorCodigo[code.toUpperCase()] || []).reverse() // mais recente primeiro
      });
    });
  }
  return { geradoEm: agora(), parcels: parcels };
}

// Permite ao botão "Atualizar" do dashboard forçar uma recolha aos CTT.
function atualizarViaDashboard() {
  atualizarEncomendas();
  return obterDados();
}

// Fecho manual a partir do dashboard.
// modo: "fechar" (marca Fechada manual) | "reabrir" (volta ao automático).
function definirFecho(code, modo) {
  code = String(code || "").trim().toUpperCase();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const enc = ss.getSheetByName(FOLHA_ENC);
  if (!enc || enc.getLastRow() < 2) return obterDados();

  const codes = enc.getRange(2, 1, enc.getLastRow() - 1, 1).getValues();
  for (let i = 0; i < codes.length; i++) {
    if (String(codes[i][0] || "").trim().toUpperCase() === code) {
      const linha = i + 2;
      if (modo === "fechar") {
        enc.getRange(linha, 11).setValue("Fechada");        // coluna K
        enc.getRange(linha, 10).setValue("🔒 Fechada (manual)"); // coluna J (Seguimento)
      } else { // reabrir
        enc.getRange(linha, 11).setValue("Automático");
        enc.getRange(linha, 10).setValue("🟡 Ativa");
      }
      break;
    }
  }
  return obterDados();
}

// Adiciona uma encomenda a partir do dashboard e consulta logo o estado.
function adicionarEncomenda(code, descricao) {
  code = String(code || "").trim().toUpperCase();
  descricao = String(descricao || "").trim();
  if (!code) return { ok: false, msg: "Indica um número de objeto." };

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let enc = ss.getSheetByName(FOLHA_ENC);
  if (!enc) { configurar(); enc = ss.getSheetByName(FOLHA_ENC); }

  // Já existe?
  const last = enc.getLastRow();
  if (last > 1) {
    const codes = enc.getRange(2, 1, last - 1, 1).getValues();
    for (let i = 0; i < codes.length; i++) {
      if (String(codes[i][0] || "").trim().toUpperCase() === code) {
        return { ok: false, msg: "Esse objeto já está na lista." };
      }
    }
  }

  const linha = enc.getLastRow() + 1;
  enc.getRange(linha, 1).setValue(code);
  if (descricao) enc.getRange(linha, 2).setValue(descricao);

  // Consultar já o estado
  try {
    const sess = abrirSessao();
    if (!sess) { enc.getRange(linha, 3).setValue("⚠ Sem ligação"); return { ok: true, msg: "Adicionado (sem ligação aos CTT agora)." }; }
    const res = consultar(code, sess);
    if (res.versaoMudou) {
      enc.getRange(linha, 3).setValue("⚠ Atualizar API_VERSION (ver guia)");
    } else if (!res.found) {
      enc.getRange(linha, 3, 1, 6).setValues([["Sem informação", "Objeto ainda não registado ou inexistente", "", "", "", agora()]]);
      enc.getRange(linha, 9).setValue("Não");
      enc.getRange(linha, 10).setValue("🟡 Ativa");
    } else {
      const ev = res.events[0] || {};
      const dataEv = ev.DateTime ? Utilities.formatDate(new Date(ev.DateTime), TZ, "dd/MM/yyyy HH:mm") : "";
      const prog = (ev.Progress != null) ? Number(ev.Progress) : ""; // 0-100 (número); a coluna mostra "%"
      enc.getRange(linha, 3, 1, 6).setValues([[ ev.State || "", ev.Event || "", ev.Local || "", prog, dataEv, agora() ]]);
      enc.getRange(linha, 9).setValue("Sim");
      const fim = estadoFinal(ev.State);
      enc.getRange(linha, 10).setValue(fim ? etiquetaFechada(fim) : "🟡 Ativa");

      // Histórico
      const hist = ss.getSheetByName(FOLHA_HIST);
      if (hist) {
        const linhasHist = res.events.slice().reverse().map(function (e) {
          const d = e.DateTime ? Utilities.formatDate(new Date(e.DateTime), TZ, "dd/MM/yyyy HH:mm") : "";
          return [code, d, e.State || "", e.Event || "", e.Local || ""];
        });
        if (linhasHist.length) hist.getRange(hist.getLastRow() + 1, 1, linhasHist.length, 5).setValues(linhasHist);
      }
    }
  } catch (e) {
    enc.getRange(linha, 3).setValue("⚠ Erro");
    enc.getRange(linha, 4).setValue(String(e));
  }
  return { ok: true, msg: "Adicionado: " + code };
}

/* =========================================================================
 * ATUALIZAR A apiVersion (só se um dia o Estado passar a mostrar
 * "⚠ Atualizar API_VERSION"):
 *   1) Abre https://appserver.ctt.pt/particulares... a página de rastreio,
 *      F12 → Network → Fetch/XHR, pesquisa um objeto.
 *   2) Clica no pedido "DataActionGetObjectEventsByInputObjectCode".
 *   3) No separador "Payload"/"Request", procura "apiVersion":"XXXX".
 *   4) Copia esse XXXX e substitui o valor de API_VERSION lá em cima.
 *   (A moduleVersion é apanhada sozinha, não precisas de mexer.)
 * ========================================================================= */
