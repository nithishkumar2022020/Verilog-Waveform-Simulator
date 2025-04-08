`timescale 1ns / 1ps

module jk_ff_tb;
    // Inputs
    reg clk;
    reg reset;
    reg j;
    reg k;
    
    // Outputs
    wire q;
    wire q_bar;
    
    // Instantiate the JK flip-flop module
    jk_ff uut (
        .clk(clk),
        .reset(reset),
        .j(j),
        .k(k),
        .q(q),
        .q_bar(q_bar)
    );
    
    // Clock generation
    initial begin
        clk = 0;
        forever #5 clk = ~clk;  // 10ns clock period
    end
    
    // VCD file generation
    initial begin
        $dumpfile("jk_ff.vcd");
        $dumpvars(0, jk_ff_tb);
    end
    
    // Test sequence
    initial begin
        // Initialize inputs
        reset = 1;
        j = 0;
        k = 0;
        
        // Apply reset
        #15;
        reset = 0;
        
        // Test case 1: J=0, K=0 (No change)
        j = 0;
        k = 0;
        #20;
        
        // Test case 2: J=0, K=1 (Reset)
        j = 0;
        k = 1;
        #20;
        
        // Test case 3: J=1, K=0 (Set)
        j = 1;
        k = 0;
        #20;
        
        // Test case 4: J=1, K=1 (Toggle)
        j = 1;
        k = 1;
        #40;  // Allow toggle for multiple clock cycles
        
        // Test multiple transitions
        j = 0;
        k = 0;
        #10;
        j = 1;
        k = 0;
        #10;
        j = 0;
        k = 1;
        #10;
        j = 1;
        k = 1;
        #30;
        
        // Apply reset again
        reset = 1;
        #10;
        reset = 0;
        
        // Test J=1, K=1 again (Toggle from 0)
        j = 1;
        k = 1;
        #40;
        
        // End simulation
        $display("Simulation completed successfully");
        $finish;
    end
    
    // Monitor the outputs
    initial begin
        $monitor("Time=%0t: j=%b k=%b q=%b q_bar=%b", $time, j, k, q, q_bar);
    end
endmodule 