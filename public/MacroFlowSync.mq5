//+------------------------------------------------------------------+
//| MacroFlowSync.mq5 — free MT5 auto-sync for the MacroFlow journal   |
//| Sends recently closed deals to POST /api/journal/ingest every      |
//| minute. READ-ONLY: only queries deal history, never trades.        |
//|                                                                      |
//| Setup:                                                               |
//|  1. Copy to MQL5/Experts, compile in MetaEditor (F7).                |
//|  2. MT5 > Tools > Options > Expert Advisors: tick "Allow WebRequest  |
//|     for listed URL" and add your app origin (https://...).           |
//|  3. Attach to any chart, enable Algo Trading, paste API key + URL.   |
//| Works only while this terminal is running (use a VPS for 24/7).      |
//+------------------------------------------------------------------+
#property copyright "MacroFlow"
#property version   "1.00"
#property strict

input string ApiKey      = "";                              // MacroFlow API key (mf_...)
input string ApiUrl      = "";                              // Ingest URL (https://.../api/journal/ingest)
input int    PollSeconds = 60;                              // Sync interval (seconds)
input int    MaxTrades   = 100;                             // Max deals per sync (server limit)

#define EA_VERSION "1.0"

//+------------------------------------------------------------------+
//| Minimal JSON string escaper                                        |
//+------------------------------------------------------------------+
string JsonEscape(const string raw)
  {
   string out = raw;
   StringReplace(out, "\\", "\\\\");
   StringReplace(out, "\"", "\\\"");
   StringReplace(out, "\r", "");
   StringReplace(out, "\n", "\\n");
   StringReplace(out, "\t", "\\t");
   return(out);
  }

//+------------------------------------------------------------------+
//| Find the opening (ENTRY_IN) deal of a position                    |
//+------------------------------------------------------------------+
bool GetPositionEntry(const ulong position_id, const string symbol,
                      double &entry_price, datetime &entry_time,
                      double &sl, double &tp)
  {
   const int total = HistoryDealsTotal();
   for(int i = 0; i < total; i++)
     {
      const ulong t = HistoryDealGetTicket(i);
      if(t == 0)
         continue;
      if((ulong)HistoryDealGetInteger(t, DEAL_POSITION_ID) != position_id)
         continue;
      if(HistoryDealGetInteger(t, DEAL_ENTRY) != DEAL_ENTRY_IN)
         continue;
      if(HistoryDealGetString(t, DEAL_SYMBOL) != symbol)
         continue;
      entry_price = HistoryDealGetDouble(t, DEAL_PRICE);
      entry_time  = (datetime)HistoryDealGetInteger(t, DEAL_TIME);
      sl          = HistoryDealGetDouble(t, DEAL_SL);
      tp          = HistoryDealGetDouble(t, DEAL_TP);
      return(true);
     }
   return(false);
  }

//+------------------------------------------------------------------+
//| POST a JSON payload, return true when {"ok":true,...}             |
//+------------------------------------------------------------------+
bool PostJson(const string json)
  {
   char   data[];
   char   result[];
   string headers = "Content-Type: application/json\r\nAuthorization: Bearer " + ApiKey + "\r\n";

   const int json_len = StringToCharArray(json, data, 0, WHOLE_ARRAY, CP_UTF8);
   if(json_len <= 1)
     {
      Print("[MacroFlowSync] failed to encode payload");
      return(false);
     }
   ArrayResize(data, json_len - 1); // drop trailing zero

   string result_headers = "";
   ResetLastError();
   const int code = WebRequest("POST", ApiUrl, headers, 15000, data, result, result_headers);
   if(code == -1)
     {
      Print("[MacroFlowSync] WebRequest failed, error=", GetLastError(),
            ". Allow the app origin under Tools > Options > Expert Advisors.");
      return(false);
     }
   string body = CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8);
   if(code != 200)
     {
      Print("[MacroFlowSync] HTTP ", code, ": ", StringSubstr(body, 0, 300));
      return(false);
     }
   if(StringFind(body, "\"ok\":true") < 0)
     {
      Print("[MacroFlowSync] unexpected response: ", StringSubstr(body, 0, 300));
      return(false);
     }
   Print("[MacroFlowSync] sync ok: ", StringSubstr(body, 0, 300));
   return(true);
  }

//+------------------------------------------------------------------+
int OnInit()
  {
   if(StringLen(ApiKey) == 0 || StringLen(ApiUrl) == 0)
     {
      Print("[MacroFlowSync] set ApiKey and ApiUrl inputs first.");
      return(INIT_PARAMETERS_INCORRECT);
     }
   if(!EventSetTimer(PollSeconds))
      return(INIT_FAILED);
   Print("[MacroFlowSync] v", EA_VERSION, " started. Polling every ", PollSeconds, "s.");
   return(INIT_SUCCEEDED);
  }

void OnDeinit(const int reason)
  {
   EventKillTimer();
  }

void OnTimer()
  {
//--- Server time -> UTC: MQL5 datetime counts Unix seconds in SERVER time.
//--- Subtract the current server/GMT offset. Approximate for old trades
//--- across DST changes (server re-syncs are idempotent anyway).
   const long gmt_offset = (long)TimeCurrent() - (long)TimeGMT();

   if(!HistorySelect(0, TimeCurrent()))
     {
      Print("[MacroFlowSync] HistorySelect failed, error=", GetLastError());
      return;
     }

   const string login    = IntegerToString((long)AccountInfoInteger(ACCOUNT_LOGIN));
   const string server   = AccountInfoString(ACCOUNT_SERVER);
   const string currency = AccountInfoString(ACCOUNT_CURRENCY);

   string trades_json = "";
   int    sent = 0;
   const int total = HistoryDealsTotal();

//--- Walk newest-first so the MaxTrades cap keeps the latest closes.
   for(int i = total - 1; i >= 0 && sent < MaxTrades; i--)
     {
      const ulong ticket = HistoryDealGetTicket(i);
      if(ticket == 0)
         continue;
      if(HistoryDealGetInteger(ticket, DEAL_ENTRY) != DEAL_ENTRY_OUT)
         continue; // only closing deals

      const string symbol = HistoryDealGetString(ticket, DEAL_SYMBOL);
      if(StringLen(symbol) == 0)
         continue;

      const ulong  position_id = (ulong)HistoryDealGetInteger(ticket, DEAL_POSITION_ID);
      const double volume      = HistoryDealGetDouble(ticket, DEAL_VOLUME);
      const double exit_price  = HistoryDealGetDouble(ticket, DEAL_PRICE);
      const double profit      = HistoryDealGetDouble(ticket, DEAL_PROFIT);
      const double commission  = HistoryDealGetDouble(ticket, DEAL_COMMISSION);
      const double swap        = HistoryDealGetDouble(ticket, DEAL_SWAP);
      const long   deal_type   = HistoryDealGetInteger(ticket, DEAL_TYPE);
      datetime close_time      = (datetime)HistoryDealGetInteger(ticket, DEAL_TIME);

      double   entry_price = exit_price;
      datetime entry_time  = close_time;
      double   sl = 0.0, tp = 0.0;
      GetPositionEntry(position_id, symbol, entry_price, entry_time, sl, tp);

      if(volume <= 0.0 || entry_price <= 0.0 || exit_price <= 0.0)
         continue;

      const string side = (deal_type == DEAL_TYPE_SELL) ? "sell" : "buy";

      //--- Risk money via hypothetical SL exit (approximate for old trades).
      string risk_json = "null";
      if(sl > 0.0)
        {
         double risk_profit = 0.0;
         ENUM_ORDER_TYPE action = (side == "buy") ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;
         if(OrderCalcProfit(action, symbol, volume, entry_price, sl, risk_profit))
           {
            double risk_amount = -risk_profit;
            if(risk_amount > 0.0)
               risk_json = DoubleToString(risk_amount, 2);
           }
        }

      const long entry_utc = (long)entry_time - gmt_offset;
      const long exit_utc  = (long)close_time - gmt_offset;

      string t = StringFormat(
         "{\"ticket\":\"%I64u\",\"symbol\":\"%s\",\"side\":\"%s\",\"volume\":%s,"
         "\"entry_time\":%d,\"exit_time\":%d,\"entry_price\":%s,\"exit_price\":%s,"
         "\"sl\":%s,\"tp\":%s,\"profit\":%s,\"commission\":%s,\"swap\":%s,\"risk_amount\":%s}",
         ticket, symbol, side,
         DoubleToString(volume, 2),
         entry_utc, exit_utc,
         DoubleToString(entry_price, Digits(symbol)),
         DoubleToString(exit_price, Digits(symbol)),
         sl > 0.0 ? DoubleToString(sl, Digits(symbol)) : "null",
         tp > 0.0 ? DoubleToString(tp, Digits(symbol)) : "null",
         DoubleToString(profit, 2),
         DoubleToString(commission, 2),
         DoubleToString(swap, 2),
         risk_json);

      if(sent > 0)
         trades_json += ",";
      trades_json += t;
      sent++;
     }

   string payload = StringFormat(
      "{\"ea_version\":\"%s\",\"account_login\":\"%s\",\"server\":\"%s\","
      "\"currency\":\"%s\",\"trades\":[%s]}",
      EA_VERSION, JsonEscape(login), JsonEscape(server),
      JsonEscape(currency), trades_json);

   PostJson(payload);
  }
//+------------------------------------------------------------------+
