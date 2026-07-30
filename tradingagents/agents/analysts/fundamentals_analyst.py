from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder

from tradingagents.agents.utils.agent_utils import (
    get_balance_sheet,
    get_cashflow,
    get_fundamentals,
    get_income_statement,
    get_instrument_context_from_state,
    get_language_instruction,
    get_periodic_reports,
)


def create_fundamentals_analyst(llm):
    def fundamentals_analyst_node(state):
        current_date = state["trade_date"]
        instrument_context = get_instrument_context_from_state(state)

        tools = [
            get_fundamentals,
            get_periodic_reports,
            get_balance_sheet,
            get_cashflow,
            get_income_statement,
        ]

        system_message = (
            "You are an A-share fundamentals researcher. Write a comprehensive company report using Wind fundamentals, company profile, shareholder structure, financial statements, announcements, and periodic-report evidence. "
            "You must call `get_periodic_reports` and include a standalone section titled `定期报告精读` (or the selected output language equivalent). "
            "Do not start the report with phrases such as 'all data has been obtained' or 'data is complete'. Instead, state that the report uses Wind available data and explicitly lists unavailable data. "
            "At the start of the periodic-report section, include an evidence coverage table with these columns: report/disclosure title, announcement date, inferred reporting period, key evidence used, missing or unavailable items. "
            "Only treat annual/semiannual/quarterly reports and disclosure items returned by Wind as retrieved evidence; if a desired report period or statement detail is absent, mark it as DATA_UNAVAILABLE. "
            "Focus on business model, industry position, revenue/profit growth, margin trend, ROE/ROA, operating cash-flow quality, free cash flow, leverage, capital expenditure, receivables/inventory pressure, shareholder and restricted-share changes, valuation relative to peers or sector when available, and whether current market pricing is supported by fundamentals. "
            "For periodic reports specifically, extract business structure, major products/customers/suppliers when available, capex and capacity expansion, R&D, management discussion tone, risk warnings, accounting or impairment signals, and changes versus prior periods. "
            "Clearly separate verified Wind data from hypotheses and explicitly flag DATA_UNAVAILABLE gaps instead of filling them in."
            + " Make sure to append a Markdown table at the end of the report to organize key points in the report, organized and easy to read."
            + " Use the available tools: `get_fundamentals` for company profile, core financials, valuation, holders, and industry context; `get_periodic_reports` for annual/semiannual/quarterly report evidence; `get_balance_sheet`, `get_cashflow`, and `get_income_statement` for specific financial statements. If one sub-report is unavailable, continue with the available Wind evidence and lower confidence."
            + get_language_instruction(),
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
            "fundamentals_report": report,
        }

    return fundamentals_analyst_node
