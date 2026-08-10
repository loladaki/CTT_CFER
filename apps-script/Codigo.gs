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

// ======================= MENU =======================
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("CTT")
    .addItem("Atualizar agora", "atualizarEncomendas")
    .addSeparator()
    .addItem("Configurar (1ª vez)", "configurar")
    .addItem("Ativar atualização diária", "ativarDiario")
    .addItem("Desativar atualização diária", "desativarDiario")
    .addToUi();
}

// ======================= CONFIGURAÇÃO INICIAL =======================
function configurar() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // --- Folha "Encomendas" ---
  let enc = ss.getSheetByName(FOLHA_ENC) || ss.insertSheet(FOLHA_ENC, 0);
  const cabec = ["Nº Objeto", "Descrição", "Estado", "Situação (último evento)",
                 "Local", "Progresso", "Data do evento", "Verificado em", "Encontrado"];
  enc.getRange(1, 1, 1, cabec.length).setValues([cabec])
     .setFontWeight("bold").setBackground("#c8102e").setFontColor("#ffffff");
  enc.setFrozenRows(1);
  enc.setColumnWidth(1, 150); enc.setColumnWidth(2, 200);
  enc.setColumnWidth(3, 140); enc.setColumnWidth(4, 320);
  enc.setColumnWidth(5, 180); enc.setColumnWidth(7, 150); enc.setColumnWidth(8, 150);
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
  const kpis = [
    ["Painel de Encomendas CTT", ""],
    ["Total", '=COUNTA(' + "'" + FOLHA_ENC + "'!A2:A)"],
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
  pain.getRange(3, 2).setFontColor("#b42318").setFontWeight("bold"); // devolvidas
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

  for (let i = 0; i < codigos.length; i++) {
    const code = String(codigos[i][0] || "").trim().toUpperCase();
    const linha = i + 2;
    if (!code) continue;

    let res;
    try { res = consultar(code, sess); }
    catch (e) { enc.getRange(linha, 3, 1, 7).setValues([["⚠ Erro", String(e), "", "", "", "", agora()]]); continue; }

    if (res.versaoMudou) {
      enc.getRange(linha, 3).setValue("⚠ Atualizar API_VERSION (ver guia)");
      continue;
    }
    if (!res.found) {
      enc.getRange(linha, 3, 1, 7).setValues([["Sem informação", "Objeto ainda não registado ou inexistente", "", "", "", "", agora()]]);
      enc.getRange(linha, 9).setValue("Não");
      continue;
    }

    const ev = res.events[0] || {};
    const dataEv = ev.DateTime ? Utilities.formatDate(new Date(ev.DateTime), TZ, "dd/MM/yyyy HH:mm") : "";
    const prog = (ev.Progress != null) ? (ev.Progress + "%") : "";
    enc.getRange(linha, 3, 1, 7).setValues([[ ev.State || "", ev.Event || "", ev.Local || "", prog, dataEv, agora() ]]);
    enc.getRange(linha, 9).setValue("Sim");

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
    Utilities.sleep(400); // ser simpático com o site dos CTT
  }

  if (hist && novosHist.length) {
    hist.getRange(hist.getLastRow() + 1, 1, novosHist.length, 5).setValues(novosHist);
  }
  ss.toast("Atualização concluída ✅  (" + (codigos.length) + " objeto(s))", "CTT", 5);
}

function agora() { return Utilities.formatDate(new Date(), TZ, "dd/MM/yyyy HH:mm"); }

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
  ScriptApp.newTrigger("atualizarEncomendas").timeBased().everyDays(1).atHour(7).create();
  SpreadsheetApp.getUi().alert("Atualização diária ativada ✅ (todos os dias por volta das 7h).");
}
function desativarDiario() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "atualizarEncomendas") ScriptApp.deleteTrigger(t);
  });
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
