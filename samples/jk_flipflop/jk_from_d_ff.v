`timescale 1ns / 1ps

// D flip-flop module for use in JK flip-flop implementation
module d_ff (
    input clk,
    input reset,
    input d,
    output reg q,
    output q_bar
);
    assign q_bar = ~q;
    
    always @(posedge clk or posedge reset) begin
        if (reset) begin
            q <= 1'b0;
        end else begin
            q <= d;
        end
    end
endmodule

// JK flip-flop constructed from D flip-flop
module jk_from_d_ff (
    input clk,
    input reset,
    input j,
    input k,
    output q,
    output q_bar
);
    // Internal wires
    wire d_input;
    
    // JK to D conversion:
    // D = J·Q̄ + K̄·Q
    assign d_input = (j & q_bar) | (~k & q);
    
    // D flip-flop instance
    d_ff d_flip_flop (
        .clk(clk),
        .reset(reset),
        .d(d_input),
        .q(q),
        .q_bar(q_bar)
    );
endmodule 