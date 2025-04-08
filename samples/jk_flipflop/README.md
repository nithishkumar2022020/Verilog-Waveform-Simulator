# JK Flip-Flop Verilog Implementation

This directory contains implementations of JK flip-flops in Verilog, along with testbenches to verify their functionality.

## Files

- `jk_ff.v` - Basic JK flip-flop implementation
- `jk_ff_tb.v` - Testbench for the basic JK flip-flop
- `jk_ms_ff.v` - Master-Slave JK flip-flop implementation
- `jk_ms_ff_tb.v` - Testbench for the Master-Slave JK flip-flop
- `jk_from_d_ff.v` - JK flip-flop implemented using D flip-flops
- `jk_from_d_ff_tb.v` - Testbench for the JK from D flip-flop implementation

## JK Flip-Flop Logic

A JK flip-flop is a universal flip-flop with two inputs: J (Set) and K (Reset). Its behavior is as follows:

| J | K | Q (next) | Operation |
|---|---|----------|-----------|
| 0 | 0 | Q        | No change |
| 0 | 1 | 0        | Reset     |
| 1 | 0 | 1        | Set       |
| 1 | 1 | ~Q       | Toggle    |

## Implementations

### Basic JK Flip-Flop

The basic JK flip-flop (`jk_ff.v`) triggers on the positive edge of the clock and has an asynchronous reset. The behavior follows the standard JK flip-flop truth table.

### Master-Slave JK Flip-Flop

The Master-Slave JK flip-flop (`jk_ms_ff.v`) consists of two stages:
1. **Master Stage**: Captures the input at the positive clock edge
2. **Slave Stage**: Transfers the master's state to the output at the negative clock edge

This design prevents race conditions (also known as the "ones catching" problem) by ensuring that the output cannot change in response to input changes during a single clock cycle.

### JK Flip-Flop from D Flip-Flop

The `jk_from_d_ff.v` file demonstrates how to implement a JK flip-flop using a D flip-flop as the underlying storage element. This shows the conversion between flip-flop types and is useful for understanding how different flip-flops relate to each other.

The conversion from JK to D is implemented using the formula:
```
D = J·Q̄ + K̄·Q
```

This means:
- When J=1 and Q=0, D=1 (Set)
- When K=1 and Q=1, D=0 (Reset)
- When J=K=0, D=Q (Hold)
- When J=K=1, D=~Q (Toggle)

## Running the Simulations

To simulate these files with the VS Code extension:

1. Open any of the testbench files (`jk_ff_tb.v`, `jk_ms_ff_tb.v`, or `jk_from_d_ff_tb.v`) in VS Code
2. Run the "Verilog Analyzer: Generate Waveform" command
3. The waveform viewer will show the operation of the flip-flop

Or using command line Icarus Verilog:

```bash
# For the basic JK flip-flop
iverilog -o jk_ff_sim jk_ff.v jk_ff_tb.v
vvp jk_ff_sim

# For the Master-Slave JK flip-flop
iverilog -o jk_ms_ff_sim jk_ms_ff.v jk_ms_ff_tb.v
vvp jk_ms_ff_sim

# For the JK flip-flop implemented using D flip-flop
iverilog -o jk_from_d_ff_sim jk_from_d_ff.v jk_from_d_ff_tb.v
vvp jk_from_d_ff_sim
```

## Testing

The testbenches include several test cases:
1. Standard operations (J=0/K=0, J=0/K=1, J=1/K=0, J=1/K=1)
2. Multiple state transitions
3. Reset operation
4. Race condition tests (Master-Slave testbench)

## Waveform Analysis

When analyzing the waveforms, note the following:
- In the basic JK flip-flop, look for the output changing immediately at the positive clock edge
- In the Master-Slave JK flip-flop, observe the internal `master_q` signal changing at the positive edge, while the output `q` changes at the negative edge
- In the JK-from-D implementation, the `d_input` signal shows the result of the JK-to-D conversion formula
- Compare the behavior of all designs when inputs change near the clock edges

## Practical Applications

JK flip-flops are commonly used in:
1. Counters and frequency dividers
2. Shift registers
3. State machines
4. Pulse detection circuits 