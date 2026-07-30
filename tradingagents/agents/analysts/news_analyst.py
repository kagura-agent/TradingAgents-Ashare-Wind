from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder

from tradingagents.agents.utils.agent_utils import (
    get_earnings_preannouncements,
    get_global_news,
    get_insider_transactions,
    get_instrument_context_from_state,
    get_language_instruction,
    get_macro_indicators,
    get_news,
)


def create_news_analyst(llm):
    def news_analyst_node(state):
        current_date = state["trade_date"]
        asset_type = state.get("asset_type", "stock")
        asset_label = "company" if asset_type == "stock" else "asset"
        instrument_context = get_instrument_context_from_state(state)

        tools = [
            get_news,
            get_earnings_preannouncements,
            get_global_news,
            get_insider_transactions,
            get_macro_indicators,
        ]

        system_message = (
            f"You are an A-share news and policy researcher. Analyze recent Wind-sourced company news, exchange announcements, regulatory disclosures, earnings preannouncements/preliminary results, macro policy, industry events, and market-wide A-share themes that are relevant to {asset_label} trading. Use get_news(ticker, start_date, end_date) for company-specific Wind news plus announcements, get_earnings_preannouncements(ticker, curr_date, look_back_days) for A-share earnings previews, alerts, revisions, and preliminary results, get_global_news(curr_date, look_back_days, limit) for A-share market, policy, and industry headlines, get_insider_transactions(ticker) for financing/short-selling, Dragon Tiger List, limit-up/limit-down, shareholder actions, and company events, and get_macro_indicators(indicator, curr_date, look_back_days) for China macro or industry indicator context from Wind EDB. Do not discuss FRED, Yahoo Finance, Polymarket, Fed prediction markets, Reddit, or StockTwits. Distinguish confirmed company disclosures from media reports and market rumors, and separate company-specific catalysts from sector/theme-driven noise. Treat earnings preannouncements as high-priority catalysts: extract profit range, YoY range, implied single-quarter performance, whether it beats or misses market expectations when evidence exists, and what later formal report must verify. Provide specific, actionable insights with supporting evidence for A-share trading."
            + """ Make sure to append a Markdown table at the end of the report to organize key points in the report, organized and easy to read."""
            + get_language_instruction()
        )

        prompt = ChatPromptTemplate.from_messages(
            [
                (
                    "system",
                    "You are a helpful AI assistant, collaborating with other assistants."
                    " Use the provided tools to progress towards answering the question."
                    " If you are unable to fully answer, that's OK; another assistant with different tools"
                    " will help where you left off. Execute what you can to make progress."
                    " If you or any other assistant has the FINAL TRANSACTION PROPOSAL: **BUY/HOLD/SELL** or deliverable,"
                    " prefix your response with FINAL TRANSACTION PROPOSAL: **BUY/HOLD/SELL** so the team knows to stop."
                    " You have access to the following tools: {tool_names}."
                    " Today's date is {current_date}; treat it as 'now' for all analysis and tool-call date ranges. {instrument_context}\n"
                    "{system_message}",
                ),
                MessagesPlaceholder(variable_name="messages"),
            ]
        )

        prompt = prompt.partial(system_message=system_message)
        prompt = prompt.partial(tool_names=", ".join([tool.name for tool in tools]))
        prompt = prompt.partial(current_date=current_date)
        prompt = prompt.partial(instrument_context=instrument_context)

        chain = prompt | llm.bind_tools(tools)
        result = chain.invoke(state["messages"])

        report = ""

        if len(result.tool_calls) == 0:
            report = result.content

        return {
            "messages": [result],
            "news_report": report,
        }

    return news_analyst_node
