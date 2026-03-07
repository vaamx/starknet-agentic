#[starknet::contract]
pub mod BondingCurve {
    use starknet::storage::*;
    use starknet::{ContractAddress, get_caller_address, get_contract_address};
    use core::num::traits::Zero;
    use openzeppelin::security::reentrancyguard::ReentrancyGuardComponent;
    use crate::interfaces::{
        IBondingCurve, CurveType, IERC20TransferDispatcher, IERC20TransferDispatcherTrait,
        IAgentTokenDispatcher, IAgentTokenDispatcherTrait,
    };

    component!(
        path: ReentrancyGuardComponent, storage: reentrancy_guard, event: ReentrancyGuardEvent,
    );
    impl ReentrancyGuardInternalImpl = ReentrancyGuardComponent::InternalImpl<ContractState>;

    // Price constants (scaled by 1e18)
    const SCALE: u256 = 1_000_000_000_000_000_000; // 1e18
    const LINEAR_SLOPE: u256 = 1_000_000_000_000; // 1e12 — price grows 1e-6 per token
    const QUADRATIC_A: u256 = 1_000_000_000; // 1e9

    #[storage]
    struct Storage {
        #[substorage(v0)]
        reentrancy_guard: ReentrancyGuardComponent::Storage,
        token: ContractAddress,
        reserve_token: ContractAddress,
        curve_type: u8,
        fee_bps: u16,
        current_supply: u256,
        reserve_balance: u256,
        fees_collected: u256,
        owner: ContractAddress,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        #[flat]
        ReentrancyGuardEvent: ReentrancyGuardComponent::Event,
        Buy: Buy,
        Sell: Sell,
        FeesWithdrawn: FeesWithdrawn,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Buy {
        #[key]
        pub buyer: ContractAddress,
        pub amount: u256,
        pub cost: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Sell {
        #[key]
        pub seller: ContractAddress,
        pub amount: u256,
        pub proceeds: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct FeesWithdrawn {
        #[key]
        pub recipient: ContractAddress,
        pub amount: u256,
    }

    fn curve_type_to_u8(ct: CurveType) -> u8 {
        match ct {
            CurveType::Linear => 0,
            CurveType::Quadratic => 1,
            CurveType::Sigmoid => 2,
        }
    }

    fn u8_to_curve_type(v: u8) -> CurveType {
        if v == 0 {
            CurveType::Linear
        } else if v == 1 {
            CurveType::Quadratic
        } else {
            CurveType::Sigmoid
        }
    }

    /// Linear curve: price = base + slope * supply
    /// Cost to buy `amount` tokens from `supply`:
    ///   integral from supply to supply+amount of (base + slope*x) dx
    ///   = base*amount + slope * ((supply+amount)^2 - supply^2) / 2
    fn linear_cost(supply: u256, amount: u256) -> u256 {
        let base_cost = SCALE * amount / SCALE; // base price = 1 unit per token
        let new_supply = supply + amount;
        // slope contribution: slope * (new^2 - old^2) / 2
        let slope_cost = LINEAR_SLOPE * (new_supply * new_supply - supply * supply) / (2 * SCALE);
        base_cost + slope_cost
    }

    /// Quadratic curve: price = a * supply^2
    /// Cost = a * ((supply+amount)^3 - supply^3) / 3
    fn quadratic_cost(supply: u256, amount: u256) -> u256 {
        let new_supply = supply + amount;
        let old_cube = supply * supply * supply;
        let new_cube = new_supply * new_supply * new_supply;
        QUADRATIC_A * (new_cube - old_cube) / (3 * SCALE * SCALE)
    }

    fn compute_cost(curve_type: u8, supply: u256, amount: u256) -> u256 {
        if curve_type == 0 {
            linear_cost(supply, amount)
        } else if curve_type == 1 {
            quadratic_cost(supply, amount)
        } else {
            // Sigmoid approximation: use linear for now (can be upgraded)
            linear_cost(supply, amount)
        }
    }

    fn apply_fee(amount: u256, fee_bps: u16) -> (u256, u256) {
        let fee = amount * fee_bps.into() / 10000;
        (amount - fee, fee)
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        token: ContractAddress,
        reserve_token: ContractAddress,
        curve_type: u8,
        fee_bps: u16,
        owner: ContractAddress,
    ) {
        assert(fee_bps <= 1000, 'fee too high'); // max 10%
        self.token.write(token);
        self.reserve_token.write(reserve_token);
        self.curve_type.write(curve_type);
        self.fee_bps.write(fee_bps);
        self.current_supply.write(0);
        self.reserve_balance.write(0);
        self.fees_collected.write(0);
        self.owner.write(owner);
    }

    #[abi(embed_v0)]
    impl BondingCurveImpl of IBondingCurve<ContractState> {
        fn buy(ref self: ContractState, amount: u256) -> u256 {
            self.reentrancy_guard.start();

            let caller = get_caller_address();
            assert(!caller.is_zero(), 'caller is zero');
            assert(amount > 0, 'amount must be > 0');

            let supply = self.current_supply.read();
            let raw_cost = compute_cost(self.curve_type.read(), supply, amount);
            let fee_bps = self.fee_bps.read();
            let fee = raw_cost * fee_bps.into() / 10000;
            let total_cost = raw_cost + fee; // buyer pays raw cost + fee on top

            // Transfer reserve tokens from buyer
            let reserve = IERC20TransferDispatcher {
                contract_address: self.reserve_token.read(),
            };
            reserve.transfer_from(caller, get_contract_address(), total_cost);

            // Mint agent tokens to buyer
            let agent_token = IAgentTokenDispatcher {
                contract_address: self.token.read(),
            };
            agent_token.mint(caller, amount);

            self.current_supply.write(supply + amount);
            self.reserve_balance.write(self.reserve_balance.read() + raw_cost);
            self.fees_collected.write(self.fees_collected.read() + fee);

            self.emit(Buy { buyer: caller, amount, cost: total_cost });

            self.reentrancy_guard.end();
            total_cost
        }

        fn sell(ref self: ContractState, amount: u256) -> u256 {
            self.reentrancy_guard.start();

            let caller = get_caller_address();
            assert(!caller.is_zero(), 'caller is zero');
            assert(amount > 0, 'amount must be > 0');

            let supply = self.current_supply.read();
            assert(supply >= amount, 'insufficient supply');

            let new_supply = supply - amount;
            let raw_proceeds = compute_cost(self.curve_type.read(), new_supply, amount);
            let fee_bps = self.fee_bps.read();
            let fee = raw_proceeds * fee_bps.into() / 10000;
            let proceeds_after_fee = raw_proceeds - fee;

            let current_reserve = self.reserve_balance.read();

            // Cap proceeds at available reserve and adjust fee proportionally
            let (actual_proceeds, actual_fee) = if proceeds_after_fee > current_reserve {
                // Reserve insufficient — seller gets everything, no fee
                (current_reserve, 0_u256)
            } else if current_reserve < raw_proceeds {
                // Reserve can cover seller but not the full fee
                (proceeds_after_fee, current_reserve - proceeds_after_fee)
            } else {
                (proceeds_after_fee, fee)
            };

            // Burn agent tokens
            let agent_token = IAgentTokenDispatcher {
                contract_address: self.token.read(),
            };
            agent_token.burn(caller, amount);

            // Transfer reserve tokens to seller
            let reserve = IERC20TransferDispatcher {
                contract_address: self.reserve_token.read(),
            };
            reserve.transfer(caller, actual_proceeds);

            self.current_supply.write(new_supply);
            // Fee is carved out of reserve, not added on top — prevents double-counting
            self.reserve_balance.write(current_reserve - actual_proceeds - actual_fee);
            self.fees_collected.write(self.fees_collected.read() + actual_fee);

            self.emit(Sell { seller: caller, amount, proceeds: actual_proceeds });

            self.reentrancy_guard.end();
            actual_proceeds
        }

        fn get_buy_price(self: @ContractState, amount: u256) -> u256 {
            compute_cost(self.curve_type.read(), self.current_supply.read(), amount)
        }

        fn get_sell_price(self: @ContractState, amount: u256) -> u256 {
            let supply = self.current_supply.read();
            if supply < amount {
                return 0;
            }
            let new_supply = supply - amount;
            let raw = compute_cost(self.curve_type.read(), new_supply, amount);
            let (proceeds, _) = apply_fee(raw, self.fee_bps.read());
            proceeds
        }

        fn get_current_supply(self: @ContractState) -> u256 {
            self.current_supply.read()
        }

        fn get_reserve_balance(self: @ContractState) -> u256 {
            self.reserve_balance.read()
        }

        fn get_curve_type(self: @ContractState) -> CurveType {
            u8_to_curve_type(self.curve_type.read())
        }

        fn get_fee_bps(self: @ContractState) -> u16 {
            self.fee_bps.read()
        }

        fn get_fees_collected(self: @ContractState) -> u256 {
            self.fees_collected.read()
        }

        fn withdraw_fees(ref self: ContractState, recipient: ContractAddress) -> u256 {
            let caller = get_caller_address();
            assert(caller == self.owner.read(), 'only owner');
            let fees = self.fees_collected.read();
            assert(fees > 0, 'no fees to withdraw');

            self.fees_collected.write(0);

            let reserve = IERC20TransferDispatcher {
                contract_address: self.reserve_token.read(),
            };
            reserve.transfer(recipient, fees);

            self.emit(FeesWithdrawn { recipient, amount: fees });

            fees
        }
    }
}
