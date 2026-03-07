#[starknet::contract]
pub mod MockERC20 {
    use starknet::storage::*;
    use starknet::ContractAddress;
    use core::num::traits::Zero;

    #[storage]
    struct Storage {
        balances: Map<ContractAddress, u256>,
        allowances: Map<(ContractAddress, ContractAddress), u256>,
    }

    #[constructor]
    fn constructor(ref self: ContractState) {}

    #[external(v0)]
    fn mint(ref self: ContractState, to: ContractAddress, amount: u256) {
        let current = self.balances.entry(to).read();
        self.balances.entry(to).write(current + amount);
    }

    #[external(v0)]
    fn balance_of(self: @ContractState, account: ContractAddress) -> u256 {
        self.balances.entry(account).read()
    }

    #[external(v0)]
    fn approve(ref self: ContractState, spender: ContractAddress, amount: u256) -> bool {
        let caller = starknet::get_caller_address();
        self.allowances.entry((caller, spender)).write(amount);
        true
    }

    #[external(v0)]
    fn transfer(ref self: ContractState, recipient: ContractAddress, amount: u256) -> bool {
        let caller = starknet::get_caller_address();
        let balance = self.balances.entry(caller).read();
        assert(balance >= amount, 'insufficient balance');
        self.balances.entry(caller).write(balance - amount);
        let recipient_balance = self.balances.entry(recipient).read();
        self.balances.entry(recipient).write(recipient_balance + amount);
        true
    }

    #[external(v0)]
    fn transfer_from(
        ref self: ContractState,
        sender: ContractAddress,
        recipient: ContractAddress,
        amount: u256,
    ) -> bool {
        let caller = starknet::get_caller_address();
        let allowance = self.allowances.entry((sender, caller)).read();
        assert(allowance >= amount, 'insufficient allowance');
        self.allowances.entry((sender, caller)).write(allowance - amount);

        let balance = self.balances.entry(sender).read();
        assert(balance >= amount, 'insufficient balance');
        self.balances.entry(sender).write(balance - amount);
        let recipient_balance = self.balances.entry(recipient).read();
        self.balances.entry(recipient).write(recipient_balance + amount);
        true
    }
}
