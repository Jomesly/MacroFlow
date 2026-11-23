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
//|                                                                      |
//| Each closing deal is sent with its position's side and entry, and   |
//| every cost: the deal's own commission and fee, its share of the     |
//| commission and fee charged on the opening deals (some brokers,       |
//| such as Bybit, charge commission when the position opens), and the  |
//| swap realized at close. Partial closes split opening costs exactly.  |
//+------------------------------------------------------------------+
#property copyright "MacroFlow"
#property version   "1.03"
#property strict

input string   ApiKey         = "";   // MacroFlow API key (mf_...)
input string   ApiUrl         = "";   // Ingest URL (https://.../api/journal/ingest)
input int      PollSeconds    = 60;   // Sync interval (seconds)
input int      MaxTrades      = 100;  // Max deals per sync (server limit)
input long     ExpectedLogin  = 0;    // Only sync this account login (0 = any)
input string   ExpectedServer = "";   // Only sync this broker server (empty = any)
input datetime SyncFromUtc    = 0;    // Skip trades closed before this UTC time (0 = all)

#define EA_VERSION "1.3"

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
//| Facts about one position, read from all of its deals              |
//+------------------------------------------------------------------+
struct PositionFacts
  {
   bool     found;         // an opening deal exists
   string   side;          // "buy"/"sell" of the position, not of the closing deal
   double   entry_price;
   datetime entry_time;
   double   sl;
   double   tp;
   double   entry_costs;   // commission + fee charged on the opening deals
   double   entry_volume;  // total opened volume
   double   closed_before; // volume closed by exits earlier than this one
  };

//+------------------------------------------------------------------+
//| Read the position's deals. HistorySelectByPosition must already   |
//| have selected them; `exit_ticket` is the closing deal being sent. |
//+------------------------------------------------------------------+
void ReadPosition(const ulong exit_ticket, PositionFacts &facts)
  {
   facts.found = false;
   facts.side = "";
   facts.entry_price = 0.0;
   facts.entry_time = 0;
   facts.sl = 0.0;
   facts.tp = 0.0;
   facts.entry_costs = 0.0;
   facts.entry_volume = 0.0;
   facts.closed_before = 0.0;

   const long exit_msc = HistoryDealGetInteger(exit_ticket, DEAL_TIME_MSC);
   long first_msc = 0;
   const int total = HistoryDealsTotal();
   for(int i = 0; i < total; i++)
     {
      const ulong t = HistoryDealGetTicket(i);
      if(t == 0)
         continue;
      const long entry = HistoryDealGetInteger(t, DEAL_ENTRY);
      const long msc   = HistoryDealGetInteger(t, DEAL_TIME_MSC);
      if(entry == DEAL_ENTRY_IN)
        {
         facts.entry_volume += HistoryDealGetDouble(t, DEAL_VOLUME);
         facts.entry_costs  += HistoryDealGetDouble(t, DEAL_COMMISSION) + HistoryDealGetDouble(t, DEAL_FEE);
         if(!facts.found || msc < first_msc)
           {
            facts.found       = true;
            first_msc         = msc;
            facts.side        = (HistoryDealGetInteger(t, DEAL_TYPE) == DEAL_TYPE_SELL) ? "sell" : "buy";
            facts.entry_price = HistoryDealGetDouble(t, DEAL_PRICE);
            facts.entry_time  = (datetime)HistoryDealGetInteger(t, DEAL_TIME);
            facts.sl          = HistoryDealGetDouble(t, DEAL_SL);
            facts.tp          = HistoryDealGetDouble(t, DEAL_TP);
           }
        }
      else
         if((entry == DEAL_ENTRY_OUT || entry == DEAL_ENTRY_OUT_BY) && t != exit_ticket &&
            (msc < exit_msc || (msc == exit_msc && t < exit_ticket)))
            facts.closed_before += HistoryDealGetDouble(t, DEAL_VOLUME);
     }
  }

//+------------------------------------------------------------------+
//| This exit's share of the opening costs. Rounding the cumulative   |
//| share makes the parts of a partially closed position add up to   |
//| exactly the opening costs.                                        |
//+------------------------------------------------------------------+
double OpeningCostShare(const PositionFacts &facts, const double exit_volume, const int digits)
  {
   if(facts.entry_volume <= 0.0 || facts.entry_costs == 0.0)
      return(0.0);
   const double before = MathMin(facts.closed_before / facts.entry_volume, 1.0);
   const double after  = MathMin((facts.closed_before + exit_volume) / facts.entry_volume, 1.0);
   return(NormalizeDouble(facts.entry_costs * after, digits) - NormalizeDouble(facts.entry_costs * before, digits));
  }

//+------------------------------------------------------------------+
//| Build the JSON object for one closing deal. Re-selects history.   |
//+------------------------------------------------------------------+
bool TradeJson(const ulong ticket, const ulong position_id, const long gmt_offset,
               const int money_digits, string &json)
  {
   if(!HistorySelectByPosition(position_id))
      return(false);

   PositionFacts facts;
   ReadPosition(ticket, facts);

   const string   symbol     = HistoryDealGetString(ticket, DEAL_SYMBOL);
   const double   volume     = HistoryDealGetDouble(ticket, DEAL_VOLUME);
   const double   exit_price = HistoryDealGetDouble(ticket, DEAL_PRICE);
   const double   profit     = HistoryDealGetDouble(ticket, DEAL_PROFIT);
   const double   swap       = HistoryDealGetDouble(ticket, DEAL_SWAP);
   const datetime close_time = (datetime)HistoryDealGetInteger(ticket, DEAL_TIME);

   // Without its opening deal, infer the side: a sell closes a buy position.
   string   side        = (HistoryDealGetInteger(ticket, DEAL_TYPE) == DEAL_TYPE_SELL) ? "buy" : "sell";
   double   entry_price = exit_price;
   datetime entry_time  = close_time;
   double   sl = 0.0, tp = 0.0;
   if(facts.found)
     {
      side        = facts.side;
      entry_price = facts.entry_price;
      entry_time  = facts.entry_time;
      sl          = facts.sl;
      tp          = facts.tp;
     }
   if(StringLen(symbol) == 0 || volume <= 0.0 || entry_price <= 0.0 || exit_price <= 0.0)
      return(false);

   const double costs = NormalizeDouble(HistoryDealGetDouble(ticket, DEAL_COMMISSION) +
                                        HistoryDealGetDouble(ticket, DEAL_FEE) +
                                        OpeningCostShare(facts, volume, money_digits), money_digits);
   const int symbol_digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);

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
            risk_json = DoubleToString(risk_amount, money_digits);
        }
     }

   const long entry_utc = (long)entry_time - gmt_offset;
   const long exit_utc  = (long)close_time - gmt_offset;

   json = StringFormat(
      "{\"ticket\":\"%I64u\",\"symbol\":\"%s\",\"side\":\"%s\",\"volume\":%s,"
      "\"entry_time\":%d,\"exit_time\":%d,\"entry_price\":%s,\"exit_price\":%s,"
      "\"sl\":%s,\"tp\":%s,\"profit\":%s,\"commission\":%s,\"swap\":%s,\"risk_amount\":%s}",
      ticket, JsonEscape(symbol), side,
      DoubleToString(volume, 2),
      entry_utc, exit_utc,
      DoubleToString(entry_price, symbol_digits),
      DoubleToString(exit_price, symbol_digits),
      sl > 0.0 ? DoubleToString(sl, symbol_digits) : "null",
      tp > 0.0 ? DoubleToString(tp, symbol_digits) : "null",
      DoubleToString(profit, money_digits),
      DoubleToString(costs, money_digits),
      DoubleToString(swap, money_digits),
      risk_json);
   return(true);
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
   if(PollSeconds < 1 || MaxTrades < 1 || MaxTrades > 100 || ExpectedLogin < 0)
      return(INIT_PARAMETERS_INCORRECT);
   if(!EventSetTimer(PollSeconds))
      return(INIT_FAILED);
   Print("[MacroFlowSync] v", EA_VERSION, " started. Polling every ", PollSeconds, "s.");
   if(SyncFromUtc > 0)
      Print("[MacroFlowSync] syncing trades closed from UTC ", TimeToString(SyncFromUtc, TIME_DATE|TIME_SECONDS));
   if(ExpectedLogin > 0 || StringLen(ExpectedServer) > 0)
      Print("[MacroFlowSync] only account ", ExpectedLogin, " on ", ExpectedServer);
   return(INIT_SUCCEEDED);
  }

void OnDeinit(const int reason)
  {
   EventKillTimer();
  }

void OnTimer()
  {
   // Account details are unavailable until the broker connection is ready.
   if(!TerminalInfoInteger(TERMINAL_CONNECTED) ||
      StringLen(AccountInfoString(ACCOUNT_CURRENCY)) == 0)
     {
      Print("[MacroFlowSync] waiting for broker connection and account currency.");
      return;
     }
   const long   login_id = AccountInfoInteger(ACCOUNT_LOGIN);
   const string server   = AccountInfoString(ACCOUNT_SERVER);
   if((ExpectedLogin > 0 && login_id != ExpectedLogin) ||
      (StringLen(ExpectedServer) > 0 && server != ExpectedServer))
     {
      Print("[MacroFlowSync] waiting for configured account ", ExpectedLogin,
            " on ", ExpectedServer, ". No account data sent.");
      return;
     }

   // TimeCurrent is the last quote time and can be stale over the weekend.
   // Wait for a recent quote before deriving the broker-to-UTC offset.
   const bool fresh_quote = MathAbs((double)((long)TimeTradeServer() - (long)TimeCurrent())) <= 300;
   if(!fresh_quote)
      Print("[MacroFlowSync] heartbeat only; waiting for a fresh broker quote before sending trades.");

//--- Server time -> UTC: MQL5 datetime counts Unix seconds in SERVER time.
//--- Subtract the current server/GMT offset. Approximate for old trades
//--- across DST changes (server re-syncs are idempotent anyway).
   const long gmt_offset   = (long)TimeCurrent() - (long)TimeGMT();
   const int  money_digits = (int)AccountInfoInteger(ACCOUNT_CURRENCY_DIGITS);

   if(!HistorySelect(0, TimeCurrent()))
     {
      Print("[MacroFlowSync] HistorySelect failed, error=", GetLastError());
      return;
     }

//--- Collect the newest closing deals first (MaxTrades keeps the latest);
//--- reading each position afterwards re-selects the history.
   ulong exits[];
   ulong positions[];
   int   count = 0;
   const int total = HistoryDealsTotal();
   for(int i = total - 1; fresh_quote && i >= 0 && count < MaxTrades; i--)
     {
      const ulong ticket = HistoryDealGetTicket(i);
      if(ticket == 0 || HistoryDealGetInteger(ticket, DEAL_ENTRY) != DEAL_ENTRY_OUT)
         continue; // only closing deals
      const long close_utc = HistoryDealGetInteger(ticket, DEAL_TIME) - gmt_offset;
      if(SyncFromUtc > 0 && close_utc < (long)SyncFromUtc)
         continue;
      ArrayResize(exits, count + 1);
      ArrayResize(positions, count + 1);
      exits[count]     = ticket;
      positions[count] = (ulong)HistoryDealGetInteger(ticket, DEAL_POSITION_ID);
      count++;
     }

   string trades_json = "";
   int    sent = 0;
   for(int k = 0; k < count; k++)
     {
      string t = "";
      if(!TradeJson(exits[k], positions[k], gmt_offset, money_digits, t))
         continue;
      if(sent > 0)
         trades_json += ",";
      trades_json += t;
      sent++;
     }

   string payload = StringFormat(
      "{\"ea_version\":\"%s\",\"account_login\":\"%s\",\"server\":\"%s\","
      "\"currency\":\"%s\",\"trades\":[%s]}",
      EA_VERSION, JsonEscape(IntegerToString(login_id)), JsonEscape(server),
      JsonEscape(AccountInfoString(ACCOUNT_CURRENCY)), trades_json);

   PostJson(payload);
  }
//+------------------------------------------------------------------+
