from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder

from tradingagents.agents.utils.agent_utils import (
    get_industry_chain_context,
    get_instrument_context_from_state,
    get_language_instruction,
)


def create_industry_chain_analyst(llm):
    def industry_chain_analyst_node(state):
        current_date = state["trade_date"]
        instrument_context = get_instrument_context_from_state(state)

        tools = [get_industry_chain_context]

        system_message = (
            "You are an A-share industry-chain analyst. Your job is to explain whether the company's industry, supply chain, and theme context support or undermine the investment thesis. "
            "You must call `get_industry_chain_context` for the exact ticker and analysis date before writing. "
            "Focus on: industry positioning, upstream raw materials or constraints, downstream demand, policy support or regulatory risk, sector-theme heat, peer comparison, overseas mapping, customer/industry concentration, capex cycle, and whether current company performance is mostly company-specific or industry-beta driven. "
            "Separate confirmed Wind evidence from interpretation. If peer, policy, or supply-chain data is unavailable, mark it as DATA_UNAVAILABLE rather than guessing. "
            "End with a table covering: industry driver, direction, evidence, confidence, impact on the stock, and what to verify next."
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
            "industry_report": report,
        }

    return industry_chain_analyst_node
