`timescale 1ns / 1ps

module jk_ff (
    input clk,        // Clock input
    input reset,      // Asynchronous reset
    input j,          // J input
    input k,          // K input
    output reg q,     // Q output
    output q_bar      // Q' (not Q) output
);

    // Complementary output
    assign q_bar = ~q;
    
    // JK flip-flop behavior
    always @(posedge clk or posedge reset) begin
        if (reset) begin
            q <= 1'b0;  // Reset to 0
        end else begin
            case ({j, k})
                2'b00: q <= q;       // No change
                2'b01: q <= 1'b0;    // Reset
                2'b10: q <= 1'b1;    // Set
                2'b11: q <= ~q;      // Toggle
            endcase
        end
    end
endmodule 