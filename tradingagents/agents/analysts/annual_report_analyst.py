from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder

from tradingagents.agents.utils.agent_utils import (
    get_earnings_preannouncements,
    get_instrument_context_from_state,
    get_language_instruction,
    get_periodic_reports,
)


def create_annual_report_analyst(llm):
    def annual_report_analyst_node(state):
        current_date = state["trade_date"]
        instrument_context = get_instrument_context_from_state(state)

        tools = [get_periodic_reports, get_earnings_preannouncements]

        system_message = (
            "You are an A-share annual-report and periodic-disclosure analyst. "
            "Your job is not to make a final trading call, but to produce a rigorous evidence memo from annual reports, semiannual reports, quarterly reports, corrections, and related disclosures retrieved from Wind. "
            "You must call `get_periodic_reports` for the exact ticker and analysis date before writing. "
            "You should also call `get_earnings_preannouncements` to identify A-share earnings forecasts, preliminary results, revisions, and alerts that bridge formal periodic reports. "
            "Do not write phrases such as 'all required data has been obtained' or 'data is complete'. Say that the memo uses Wind-available disclosures and clearly marks unavailable items. "
            "Start with a coverage table listing report/disclosure title, announcement date, inferred reporting period, key evidence used, and missing or unavailable items. Copy the retrieved report titles and announcement dates exactly from the Wind evidence coverage when available; do not invent extra report rows, correction rows, or disclosure dates. "
            "Then analyze: business structure, revenue and profit trend, margin trend, cash-flow quality, free cash flow, capital expenditure, construction-in-progress or capacity expansion, receivables, inventory, contract liabilities, debt and liquidity, R&D, customer/supplier concentration, shareholder or governance signals, management discussion tone, risk warnings, accounting or impairment signals, earnings preannouncement implications, and changes versus prior periods. "
            "Clearly separate Wind-retrieved facts from your interpretation. If a report period or statement detail is missing, write DATA_UNAVAILABLE instead of estimating it. "
            "End with three lists: evidence supporting a bullish thesis, evidence supporting a bearish thesis, and follow-up verification items for the research team."
            + get_language_instruction()
        )

        prompt = ChatPromptTemplate.from_messages(
            [
                (
                    "system",
                    "You are a helpful AI assistant, collaborating with other assistants."
                    " Use the provided tools to progress towards answering the question."
                    " You have access to the following tools: {tool_names}."
                    " Today's date is {current_date}; treat it as the as-of date and do not use disclosures after it. {instrument_context}\n"
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
            "annual_report": report,
        }

    return annual_report_analyst_node
